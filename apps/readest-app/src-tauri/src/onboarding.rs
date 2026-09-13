//! First-run onboarding bridge.
//!
//! Two commands back the onboarding overlay:
//!
//!   * `onboarding_sample_book` — returns the bundled sample .hpub as raw
//!     bytes so the frontend can build a `File` and run it through the
//!     regular `ingestFile` import path (unpack + sidecars + cover +
//!     library registration). Returning bytes sidesteps fs/asset scope
//!     grants for the app-bundle directory entirely.
//!   * `onboarding_run_voice_bootstrap` — runs the idempotent
//!     `resources/tts/bootstrap_voice.sh` and streams its stdout/stderr to
//!     the overlay as `voice-bootstrap-progress` events.

use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

/// Resolve a bundled resource: installed bundle first, dev tree fallback.
fn resolve_resource(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(rel);
        if bundled.is_file() {
            return Ok(bundled);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    if dev.is_file() {
        return Ok(dev);
    }
    Err(format!("resource not found: {rel}"))
}

#[tauri::command]
pub async fn onboarding_sample_book(app: AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = resolve_resource(&app, "resources/sample-book.hpub")?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Run the voice bootstrap script once; progress lines stream to the
/// frontend via `voice-bootstrap-progress` events. Idempotent in the script
/// itself — safe to re-run when the user re-enters the beat.
#[tauri::command]
pub async fn onboarding_run_voice_bootstrap(app: AppHandle) -> Result<(), String> {
    if cfg!(windows) {
        return Err("voice bootstrap is only supported on macOS/Linux".to_string());
    }
    let script = resolve_resource(&app, "resources/tts/bootstrap_voice.sh")?;

    let mut child = tokio::process::Command::new("/bin/bash")
        .arg(&script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn voice bootstrap: {e}"))?;

    let mut pumps = Vec::new();
    for stream in [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ] {
        if let Some(stream) = stream {
            let app = app.clone();
            pumps.push(tokio::spawn(async move {
                let mut lines = BufReader::new(stream).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    log::info!("voice bootstrap: {line}");
                    let _ = app.emit(
                        "voice-bootstrap-progress",
                        serde_json::json!({ "line": line }),
                    );
                }
            }));
        }
    }
    for pump in pumps {
        let _ = pump.await;
    }
    let status = child
        .wait()
        .await
        .map_err(|e| format!("voice bootstrap wait failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("voice bootstrap exited with {:?}", status.code()))
    }
}
