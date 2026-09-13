//! Palimpsest voice server auto-start.
//!
//! On launch, probe the local narration server (qwen_server.py, port 8737).
//! When nothing answers, spawn the bundled server with the best available
//! Python — the model download stays lazy (first narration), so the child
//! is cheap to start. The child is reaped on app exit (`kill_on_drop`) and
//! its stdout/stderr ride the same log pipeline as everything else
//! (tauri_plugin_log -> ~/Library/Logs). If health never passes within
//! 120 s we give up silently: the narration controller already falls back
//! to Edge voices and the UI shows its offline state elsewhere.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncBufReadExt;

const HEALTH_URL: &str = "http://127.0.0.1:8737/health";
/// Probe cadence while waiting for the server to come up.
const HEALTH_POLL: Duration = Duration::from_secs(2);
/// Give up after this long; the server may still finish starting (model
/// downloads, cold MLX) — the UI shows its own offline state.
const HEALTH_LIMIT: Duration = Duration::from_secs(120);

pub fn start(app: &AppHandle) {
    #[cfg(desktop)]
    tauri::async_runtime::spawn(spawn_voice_server(app.clone()));
    #[cfg(not(desktop))]
    let _ = app;
}

#[cfg(desktop)]
fn resolve_server_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("PALIMPSEST_TTS_SCRIPT") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "PALIMPSEST_TTS_SCRIPT points at a missing file: {}",
            path.display()
        ));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("resources/tts/qwen_server.py");
        if bundled.is_file() {
            return Ok(bundled);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/tts/qwen_server.py");
    if dev.is_file() {
        return Ok(dev);
    }
    Err("qwen_server.py not found (set PALIMPSEST_TTS_SCRIPT)".to_string())
}

/// Interpreter resolution order: explicit env override, the Palimpsest-managed
/// voice venv, then hpub.rs's candidate list (dev venvs, then PATH python3).
#[cfg(desktop)]
fn resolve_python() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("PALIMPSEST_TTS_PYTHON") {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".palimpsest/venv/bin/python"));
    }
    candidates.extend(crate::hpub::python_candidates());
    candidates
        .iter()
        .find(|c| c.components().count() == 1 || c.is_file())
        .map(|c| c.to_string_lossy().into_owned())
}

#[cfg(desktop)]
async fn health_up() -> bool {
    match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client
            .get(HEALTH_URL)
            .send()
            .await
            .map(|res| res.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

#[cfg(desktop)]
async fn pump_to_log<S: tokio::io::AsyncRead + Unpin + Send + 'static>(stream: Option<S>) {
    let Some(stream) = stream else { return };
    tauri::async_runtime::spawn(async move {
        let mut lines = tokio::io::BufReader::new(stream).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                log::info!("voice server: {line}");
            }
        }
    });
}

#[cfg(desktop)]
async fn spawn_voice_server(app: AppHandle) {
    if health_up().await {
        log::info!("voice server: already answering at {HEALTH_URL}");
        return;
    }
    let (Ok(script), Some(python)) = (resolve_server_script(&app), resolve_python()) else {
        log::warn!("voice server: no interpreter or script — skipping auto-start");
        return;
    };
    log::info!("voice server: starting {} via {}", script.display(), python);

    let mut child = match tokio::process::Command::new(&python)
        .arg(&script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            log::warn!("voice server: spawn failed: {e}");
            return;
        }
    };

    pump_to_log(child.stdout.take()).await;
    pump_to_log(child.stderr.take()).await;

    let mut waited = Duration::ZERO;
    while waited < HEALTH_LIMIT {
        tokio::time::sleep(HEALTH_POLL).await;
        waited += HEALTH_POLL;
        if health_up().await {
            log::info!("voice server: healthy after {}s", waited.as_secs());
            return;
        }
    }
    log::warn!(
        "voice server: no health after {}s — leaving it running in the background",
        HEALTH_LIMIT.as_secs()
    );
}
