//! Palimpsest extraction sidecar bridge.
//!
//! Spawns the consolidated Python pipeline (`resources/hpub/make_hpub.py`)
//! which turns a digital-born PDF into the dual-layer artifact set
//! (content.md + manifest.json + assets/) written directly into the book's
//! library directory. The script speaks a tiny protocol: progress on stderr,
//! a single JSON result object as the last stdout line, and exit codes
//! 0 (ok) / 2 (scanned rejection) / 3 (quality gate) / 1 (error).
//!
//! Interpreter resolution order:
//!   1. `PALIMPSEST_PYTHON` env var (dev: point at a marker-pdf venv)
//!   2. Palimpsest-managed venv in the app data dir (`hpub-venv`)
//!   3. dev-machine phase-0 venv (exists-check only; harmless elsewhere)
//!   4. `python3` on PATH (last resort — usually lacks marker-pdf)

use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Manager};

fn python_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("PALIMPSEST_PYTHON") {
        out.push(PathBuf::from(p));
    }
    if let Ok(home) = std::env::var("HOME") {
        out.push(
            PathBuf::from(&home)
                .join("Library/Application Support/com.bilingify.readest/hpub-venv/bin/python"),
        );
        // Dev machine: the phase-0 venv that already carries marker-pdf and
        // the cached model weights. Probed with an exists-check, so this is a
        // silent no-op on any other machine.
        out.push(PathBuf::from(&home).join(
            "Documents/kimi/workspace/hpub-phase0/.venv/bin/python",
        ));
    }
    out.push(PathBuf::from("python3"));
    out
}

fn resolve_python() -> String {
    let candidates = python_candidates();
    for c in &candidates {
        // A bare command name (no separators) is always "valid" — the spawn
        // will resolve it via PATH. Paths must exist.
        let is_command = c.components().count() == 1;
        if is_command || c.is_file() {
            log::info!("hpub sidecar interpreter: {}", c.display());
            return c.to_string_lossy().into_owned();
        }
    }
    "python3".to_string()
}

fn resolve_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("PALIMPSEST_HPUB_SCRIPT") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "PALIMPSEST_HPUB_SCRIPT points at a missing file: {}",
            path.display()
        ));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("resources/hpub/make_hpub.py");
        if bundled.is_file() {
            return Ok(bundled);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/hpub/make_hpub.py");
    if dev.is_file() {
        return Ok(dev);
    }
    Err("hpub sidecar script not found (set PALIMPSEST_HPUB_SCRIPT)".to_string())
}

#[tauri::command]
pub async fn hpub_extract(
    app: AppHandle,
    pdf_path: String,
    out_dir: String,
    title: Option<String>,
    workdir: Option<String>,
) -> Result<Value, String> {
    let script = resolve_script(&app)?;
    let python = resolve_python();

    let mut cmd = tokio::process::Command::new(python);
    cmd.arg(script)
        .arg(&pdf_path)
        .arg("--out-dir")
        .arg(&out_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Marker spawns model workers; keep the job out of the app's process group lifecycle.
        .kill_on_drop(true);
    if let Some(t) = title {
        cmd.arg("--title").arg(t);
    }
    if let Some(w) = workdir {
        // Marker output cache: a retried job (previous run killed/crashed)
        // resumes from cached model output instead of re-extracting.
        cmd.arg("--workdir").arg(w);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to spawn hpub sidecar: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.is_empty() {
        log::info!("hpub sidecar progress:\n{stderr}");
    }

    // Protocol: last non-empty stdout line is the JSON result object.
    let result_line = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .ok_or_else(|| format!("hpub sidecar produced no result (stderr tail: {})", &stderr[stderr.len().saturating_sub(500)..]))?;
    let result: Value = serde_json::from_str(result_line)
        .map_err(|e| format!("hpub sidecar result not JSON: {e}: {result_line}"))?;

    // Log the outcome natively: the JS layer's console may be unreachable
    // (webview reloaded mid-job) and its logs are only partially bridged.
    log::info!(
        "hpub sidecar result for {}: {}",
        pdf_path,
        serde_json::to_string(&result).unwrap_or_default()
    );

    match output.status.code() {
        // 0 ok; 2 scanned rejection; 3 quality gate — all carry a JSON status
        // the JS layer turns into user-facing import feedback.
        Some(0) | Some(2) | Some(3) => Ok(result),
        _ => {
            let msg = format!(
                "hpub sidecar failed (status {:?}): {}",
                output.status.code(),
                result.get("detail").and_then(Value::as_str).unwrap_or(result_line)
            );
            log::error!("{msg}");
            Err(msg)
        }
    }
}
