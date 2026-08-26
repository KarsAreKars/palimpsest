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
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

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
    job_id: Option<String>,
    use_llm: Option<bool>,
    llm_api_key: Option<String>,
    llm_base_url: Option<String>,
    llm_model: Option<String>,
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
    if use_llm.unwrap_or(false) {
        cmd.arg("--use-llm");
    }
    // LLM assist credentials, scoped to the child process only — the key
    // never enters the app env. Any OpenAI-compatible multimodal endpoint.
    if let Some(key) = llm_api_key.filter(|k| !k.is_empty()) {
        cmd.env("PALIMPSEST_LLM_API_KEY", key);
    }
    if let Some(base) = llm_base_url.filter(|b| !b.is_empty()) {
        cmd.env("PALIMPSEST_LLM_BASE_URL", base);
    }
    if let Some(model) = llm_model.filter(|m| !m.is_empty()) {
        cmd.env("PALIMPSEST_LLM_MODEL", model);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn hpub sidecar: {e}"))?;

    // Stream stderr progress line-by-line to the frontend (the book card's
    // conversion badge listens on `hpub-progress`). The sidecar protocol
    // keeps progress on stderr and the JSON result as the last stdout line.
    let stderr = child.stderr.take().expect("stderr piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let progress_app = app.clone();
    let progress_job = job_id.clone().unwrap_or_default();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut transcript: Vec<String> = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            log::info!("hpub sidecar: {line}");
            let _ = progress_app.emit(
                "hpub-progress",
                serde_json::json!({ "jobId": progress_job, "line": line }),
            );
            transcript.push(line);
        }
        transcript
    });
    let stdout_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            buf.push_str(&line);
            buf.push('\n');
        }
        buf
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("hpub sidecar wait failed: {e}"))?;
    let stderr_lines = stderr_task.await.unwrap_or_default();
    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_lines.join("\n");

    // Protocol: last non-empty stdout line is the JSON result object.
    let result_line = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "hpub sidecar produced no result (stderr tail: {})",
                &stderr[stderr.len().saturating_sub(500)..]
            )
        })?;
    let result: Value = serde_json::from_str(&result_line)
        .map_err(|e| format!("hpub sidecar result not JSON: {e}: {result_line}"))?;

    // Log the outcome natively: the JS layer's console may be unreachable
    // (webview reloaded mid-job) and its logs are only partially bridged.
    log::info!(
        "hpub sidecar result for {}: {}",
        pdf_path,
        serde_json::to_string(&result).unwrap_or_default()
    );

    match status.code() {
        // 0 ok; 2 scanned rejection; 3 quality gate — all carry a JSON status
        // the JS layer turns into user-facing import feedback.
        Some(0) | Some(2) | Some(3) => Ok(result),
        _ => {
            let msg = format!(
                "hpub sidecar failed (status {:?}): {}",
                status.code(),
                result.get("detail").and_then(Value::as_str).unwrap_or(&result_line)
            );
            log::error!("{msg}");
            Err(msg)
        }
    }
}
