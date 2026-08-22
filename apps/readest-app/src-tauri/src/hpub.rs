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
//!   2. `python3` on PATH
//! Script resolution order:
//!   1. `PALIMPSEST_HPUB_SCRIPT` env var
//!   2. bundled resource `resources/hpub/make_hpub.py`
//!   3. dev path relative to CARGO_MANIFEST_DIR

use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Manager};

fn resolve_python() -> String {
    std::env::var("PALIMPSEST_PYTHON").unwrap_or_else(|_| "python3".to_string())
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

    match output.status.code() {
        // 0 ok; 2 scanned rejection; 3 quality gate — all carry a JSON status
        // the JS layer turns into user-facing import feedback.
        Some(0) | Some(2) | Some(3) => Ok(result),
        _ => Err(format!(
            "hpub sidecar failed (status {:?}): {}",
            output.status.code(),
            result.get("detail").and_then(Value::as_str).unwrap_or(result_line)
        )),
    }
}
