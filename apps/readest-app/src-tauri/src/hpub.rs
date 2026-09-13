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
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

/// Stall watchdog: the sidecar heartbeats through its long phases (marker
/// page loop, LLM cleanup) at least every 30 s, so 10 min of stderr silence
/// means the child is wedged (llama-server socket wedge, hung LLM socket —
/// the 2h narration-polish freeze class) — kill it instead of blocking the
/// import queue forever.
const STALL_LIMIT: Duration = Duration::from_secs(10 * 60);
/// Hard cap on the whole job; no legitimate book takes this long
/// (research: global timeouts derive from measured per-page cost, and our
/// worst case is ~4 s/page + cleanup — hours of slack even for 500 pp).
const HARD_CAP: Duration = Duration::from_secs(2 * 60 * 60);
/// How often the watchdog wakes to check for stalls while the child runs.
const WATCHDOG_TICK: Duration = Duration::from_secs(15);

/// Live progress shared between the stderr pump and the stall watchdog.
struct SidecarProgress {
    last_line_at: Instant,
    last_stage: String,
}

/// Extract the stage title from a sidecar progress line
/// ("[make_hpub + 12.3s] 2/6 marker extraction…" → "marker extraction…").
/// Heartbeat lines carry no N/6 fraction and leave the stage untouched.
fn parse_stage(line: &str) -> Option<String> {
    let after = line.split_once(']')?.1.trim_start();
    let (frac, title) = after.split_once(char::is_whitespace)?;
    let (n, total) = frac.split_once('/')?;
    n.trim().parse::<u32>().ok()?;
    total.trim().parse::<u32>().ok()?;
    let title = title.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

pub(crate) fn python_candidates() -> Vec<PathBuf> {
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
    let progress_state = Arc::new(Mutex::new(SidecarProgress {
        last_line_at: Instant::now(),
        last_stage: "startup".to_string(),
    }));
    let stderr_progress = Arc::clone(&progress_state);
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut transcript: Vec<String> = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(mut st) = stderr_progress.lock() {
                st.last_line_at = Instant::now();
                if let Some(stage) = parse_stage(&line) {
                    st.last_stage = stage;
                }
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

    // Wait with a stall watchdog + hard cap. A fresh wait future each tick:
    // dropping the loser of select! is cancel-safe for tokio children (the
    // reaper keeps the exit status for the next wait call).
    let started = Instant::now();
    let mut watchdog_kill: Option<String> = None;
    let status = loop {
        tokio::select! {
            status = child.wait() => {
                break status.map_err(|e| format!("hpub sidecar wait failed: {e}"))?;
            }
            _ = tokio::time::sleep(WATCHDOG_TICK) => {
                let (silence, stage) = progress_state
                    .lock()
                    .map(|st| (st.last_line_at.elapsed(), st.last_stage.clone()))
                    .unwrap_or_else(|_| (Duration::ZERO, "unknown".to_string()));
                let reason = if started.elapsed() > HARD_CAP {
                    Some(format!("no completion within the 2h hard cap during {stage}"))
                } else if silence > STALL_LIMIT {
                    Some(format!("no progress for 10m during {stage}"))
                } else {
                    None
                };
                if let Some(reason) = reason {
                    log::error!("hpub sidecar watchdog: {reason} — killing child");
                    let _ = child.kill().await;
                    watchdog_kill = Some(reason);
                    break child
                        .wait()
                        .await
                        .map_err(|e| format!("hpub sidecar wait failed after watchdog kill: {e}"))?;
                }
            }
        }
    };
    let stderr_lines = stderr_task.await.unwrap_or_default();
    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_lines.join("\n");

    // A watchdog kill is a wedged sidecar, not a bad book: hand the TS layer
    // a structured error it can persist verbatim (stage: "watchdog").
    if let Some(detail) = watchdog_kill {
        return Ok(serde_json::json!({
            "status": "error",
            "stage": "watchdog",
            "detail": detail,
        }));
    }

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

#[cfg(test)]
mod tests {
    use super::parse_stage;

    #[test]
    fn parses_stage_lines() {
        assert_eq!(
            parse_stage("[make_hpub +   12.3s] 2/6 marker extraction (51 pages — slow)"),
            Some("marker extraction (51 pages — slow)".to_string())
        );
    }

    #[test]
    fn heartbeat_lines_are_not_stages() {
        assert_eq!(parse_stage("[make_hpub +  33.7s] llm cleanup still running…"), None);
        assert_eq!(parse_stage("[make_hpub +  66.0s] WARNING: 200 replacement chars"), None);
        assert_eq!(parse_stage("random noise"), None);
    }

    #[test]
    fn malformed_fraction_is_not_a_stage() {
        assert_eq!(parse_stage("[make_hpub +   1.0s] 2x6 nope"), None);
        assert_eq!(parse_stage("[make_hpub +   1.0s] /6 missing numerator"), None);
    }
}
