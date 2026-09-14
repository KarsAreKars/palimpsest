//! Palimpsest voice server auto-start.
//!
//! On launch, probe the local narration server (qwen_server.py, port 8737).
//! When nothing answers, spawn the bundled server with the best available
//! Python — the model download stays lazy (first narration), so the child
//! is cheap to start.
//!
//! Lifetime: the spawned [`tokio::process::Child`] is held in managed state
//! for the whole app session. It must NOT be a local of the spawning task:
//! `kill_on_drop` would reap it the moment the task returns (seconds after
//! /health first passes) and every session's narration would die. The child
//! is killed explicitly on `ExitRequested` (`stop`) and reaped by
//! `kill_on_drop` as a fallback when the state drops at process exit.
//! The child's stdout/stderr ride the same log pipeline as everything else
//! (tauri_plugin_log -> ~/Library/Logs). If health never passes within
//! 120 s we give up silently: the narration controller already falls back
//! to Edge voices and the UI shows its offline state elsewhere.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncBufReadExt;

const HEALTH_URL: &str = "http://127.0.0.1:8737/health";
/// Probe cadence while waiting for the server to come up.
const HEALTH_POLL: Duration = Duration::from_secs(2);
/// Give up after this long; the server may still finish starting (model
/// downloads, cold MLX) — the UI shows its own offline state.
const HEALTH_LIMIT: Duration = Duration::from_secs(120);

/// The one spawned voice-server child, held for the app lifetime.
/// `None` before spawn (or after `stop` reaped it).
#[derive(Default)]
pub struct VoiceServerState {
    child: Mutex<Option<tokio::process::Child>>,
}

pub fn start(app: &AppHandle) {
    #[cfg(all(desktop, not(windows)))]
    {
        app.manage(VoiceServerState::default());
        tauri::async_runtime::spawn(spawn_voice_server(app.clone()));
    }
    #[cfg(not(all(desktop, not(windows))))]
    let _ = app;
}

/// Kill the voice server on app exit (reaping also happens via
/// `kill_on_drop` when the managed state drops, this just does it promptly).
pub fn stop(app: &AppHandle) {
    #[cfg(all(desktop, not(windows)))]
    {
        if let Some(state) = app.try_state::<VoiceServerState>() {
            if let Ok(mut guard) = state.child.lock() {
                if let Some(mut child) = guard.take() {
                    log::info!("voice server: stopping on exit");
                    let _ = child.start_kill();
                }
            }
        }
    }
    #[cfg(not(all(desktop, not(windows))))]
    let _ = app;
}

#[cfg(all(desktop, not(windows)))]
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

/// The same import check bootstrap_voice.sh uses: a TTS interpreter must
/// import the voice stack. Probing per candidate beats an existence check —
/// a wrong interpreter spawns, dies on import, and we poll a dead port for
/// 120 s. `misaki` matters: mlx-audio imports fine without it, then every
/// Kokoro request 500s (the runaway narration cursor, 2026-09-13). The
/// hpub/marker venvs are deliberately NOT candidates: they lack mlx-audio.
#[cfg(all(desktop, not(windows)))]
fn voice_imports_ok(python: &str) -> bool {
    std::process::Command::new(python)
        .args(["-c", "import mlx_audio, mlx_whisper, misaki"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Interpreter resolution order: explicit env override, the Palimpsest-managed
/// voice venv, the dev workspace venv, then `python3` on PATH. Every candidate
/// must pass the import probe (PATH python3 almost never does — it simply
/// isn't chosen).
#[cfg(all(desktop, not(windows)))]
fn resolve_python() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("PALIMPSEST_TTS_PYTHON") {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".palimpsest/venv/bin/python"));
        // Dev dogfood machine: the hand-built venv the narration stack was
        // tuned on. Absent on stranger machines — is_file skips it.
        candidates.push(
            PathBuf::from(&home).join("Documents/kimi/workspace/tts-venv/bin/python"),
        );
    }
    candidates.push(PathBuf::from("python3"));
    candidates
        .iter()
        .filter(|c| c.components().count() == 1 || c.is_file())
        .find(|c| voice_imports_ok(&c.to_string_lossy()))
        .map(|c| c.to_string_lossy().into_owned())
}

#[cfg(all(desktop, not(windows)))]
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

#[cfg(all(desktop, not(windows)))]
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

#[cfg(all(desktop, not(windows)))]
async fn spawn_voice_server(app: AppHandle) {
    if health_up().await {
        log::info!("voice server: already answering at {HEALTH_URL}");
        return;
    }
    let (Ok(script), Some(python)) = (resolve_server_script(&app), resolve_python()) else {
        log::warn!("voice server: no working interpreter or script — skipping auto-start");
        return;
    };
    // TOCTOU: another process may have started a server while we resolved
    // the interpreter (each probe costs a python startup).
    if health_up().await {
        log::info!("voice server: already answering at {HEALTH_URL} (post-resolve probe)");
        return;
    }
    log::info!("voice server: starting {} via {}", script.display(), python);

    let mut child = match tokio::process::Command::new(&python)
        .arg(&script)
        .stdin(Stdio::null())
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

    // Hand the child to app-lifetime state BEFORE waiting on health: this
    // task returning must not drop (and kill) the server.
    if let Some(state) = app.try_state::<VoiceServerState>() {
        match state.child.lock() {
            Ok(mut guard) => *guard = Some(child),
            Err(_) => log::error!("voice server: state lock poisoned — child will not survive"),
        }
    } else {
        log::error!("voice server: managed state missing — child will not survive");
    }

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

/// Restart the local voice server. Called from the narration layer when
/// synthesis starts failing while `/health` still answers — a half-dead
/// MLX stack: the stdlib HTTP server survives, but every generation
/// EPIPEs under it (observed 2026-09-14 after a sleep/wake cycle, ~4 h
/// into the server's life). The narration controller can't detect that
/// from a health probe, so the client counts consecutive synthesis
/// failures and asks for a restart.
///
/// Both ownership cases are handled: the child we spawned this session,
/// AND a zombie answering the port from a previous app instance (today's
/// bug — the launch probe adopted the zombie, so our own child is None
/// and killing it alone would restart nothing).
#[cfg(all(desktop, not(windows)))]
#[tauri::command]
pub async fn restart_voice_server(app: AppHandle) -> Result<bool, String> {
    log::info!("voice server: restart requested");

    // Take the child under a short scope — the std MutexGuard is not Send,
    // so it must drop before we await the kill.
    let held = app
        .try_state::<VoiceServerState>()
        .and_then(|state| state.child.lock().ok().and_then(|mut guard| guard.take()));
    if let Some(mut child) = held {
        let _ = child.start_kill();
        let _ = child.wait().await;
        log::info!("voice server: killed held child");
    }

    // Evict anything else answering :8737 (zombie from a previous app
    // instance — the launch probe adopts those, so we own no handle).
    let pids = std::process::Command::new("lsof")
        .args(["-ti", "tcp:8737"])
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .split_whitespace()
                .filter_map(|s| s.parse::<u32>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for pid in &pids {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
    if !pids.is_empty() {
        log::info!("voice server: evicted {} foreign pid(s): {:?}", pids.len(), pids);
    }

    // Wait for the port to actually go quiet before respawning.
    let mut quiet = Duration::ZERO;
    while health_up().await && quiet < Duration::from_secs(10) {
        tokio::time::sleep(Duration::from_millis(250)).await;
        quiet += Duration::from_millis(250);
    }

    spawn_voice_server(app).await;

    // Cold start re-downloads nothing (models are disk-cached) but MLX
    // load takes a few seconds — give the fresh server a grace window.
    let mut waited = Duration::ZERO;
    while waited < Duration::from_secs(60) {
        if health_up().await {
            log::info!("voice server: healthy again after {}s", waited.as_secs());
            return Ok(true);
        }
        tokio::time::sleep(HEALTH_POLL).await;
        waited += HEALTH_POLL;
    }
    log::warn!("voice server: restart did not become healthy within 60s");
    Ok(false)
}

#[cfg(not(all(desktop, not(windows))))]
#[tauri::command]
pub async fn restart_voice_server(_app: AppHandle) -> Result<bool, String> {
    Ok(false)
}
