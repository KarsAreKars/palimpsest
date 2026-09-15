//! Palimpsest voice server auto-start, with strict app ownership.
//!
//! On launch, probe the local narration server (qwen_server.py, port 8737)
//! with an adopt-or-evict strategy:
//!   * `/health` answers with our ownership token  -> adopt it, no spawn.
//!   * `/health` answers without a token (or a foreign one) -> a zombie from
//!     a previous app instance or a manual start: evict its pids, wait for
//!     the port to go quiet, spawn our own.
//!   * nothing answers -> spawn our own.
//!
//! Ownership token: a 16-byte random hex string persisted NEXT TO the app
//! data directory (`<app_data_dir>/../palimpsest-voice-token`, i.e.
//! `~/Library/Application Support/palimpsest-voice-token` on macOS — a
//! sibling of the per-bundle dir so it survives app re-launches). The
//! bundled server is spawned with `--token <hex>` and echoes it in
//! `/health`; a server started without `--token` omits the field. A
//! respawned app instance reads the same file and can therefore adopt a
//! server it started before its own restart.
//!
//! Crash-restart: a supervisor task owns the server for the whole app run.
//! If the owned child exits unexpectedly (or an adopted server stops
//! answering) while the app is still running, the supervisor respawns with
//! exponential backoff (1s, 2s, 4s, ... capped at 30s, max 5 attempts).
//! The `shutdown` AtomicBool — set on `ExitRequested` — suppresses the
//! respawn during app shutdown.
//!
//! Lifetime: the spawned [`tokio::process::Child`] is held in managed state
//! for the whole app session. It must NOT be a local of the spawning task:
//! `kill_on_drop` would reap it the moment the task returns. The child is
//! killed explicitly on `ExitRequested` (`stop`) and reaped by
//! `kill_on_drop` as a fallback when the state drops at process exit.
//! The child's stdout/stderr ride the same log pipeline as everything else
//! (tauri_plugin_log -> ~/Library/Logs). If health never passes the
//! supervisor gives up after 5 attempts: the narration controller already
//! falls back to Edge voices and the UI shows its offline state elsewhere.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncBufReadExt;

/// Port the bundled qwen_server.py binds. Keep in sync with `HEALTH_URL`.
const VOICE_PORT: u16 = 8737;
const HEALTH_URL: &str = "http://127.0.0.1:8737/health";
/// Probe cadence while waiting for the server to come up.
const HEALTH_POLL: Duration = Duration::from_secs(2);
/// Give up on a single spawn after this long (model downloads, cold MLX).
const HEALTH_LIMIT: Duration = Duration::from_secs(120);
/// Steady-state watchdog cadence once a server is considered up.
const WATCH_POLL: Duration = Duration::from_secs(5);
/// Consecutive failed health probes before a watched server is declared dead
/// (one 3s-timeout failure alone can be a sleep/wake hiccup).
const WATCH_STRIKES: u32 = 2;
/// Crash-restart backoff: 1s, 2s, 4s, ... capped at 30s.
const BACKOFF_START: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
/// Failed respawn attempts before the supervisor gives up for this app run.
const MAX_RESTART_ATTEMPTS: u32 = 5;
/// Engine self-repair (voice bootstrap) hard budget: model downloads on a
/// slow link can legitimately take minutes; past this we give up and let
/// the normal fallback (Edge voices) carry the session.
const REPAIR_TIMEOUT: Duration = Duration::from_secs(600);

/// App-lifetime voice server state.
#[derive(Default)]
pub struct VoiceServerState {
    /// The one spawned voice-server child. `None` when we adopted an
    /// already-running (token-matching) server, before spawn, or after
    /// `stop` reaped it.
    child: Mutex<Option<tokio::process::Child>>,
    /// Set by `stop` on `ExitRequested`: suppresses crash-respawn during
    /// shutdown so exiting the app doesn't look like a server crash.
    shutdown: AtomicBool,
    /// Bumped by `restart_voice_server` before it kills anything. The
    /// supervisor snapshots this at each watch/wait phase and bails out
    /// promptly (re-probing from scratch) when it changes — otherwise a
    /// user-triggered restart could race a supervisor respawn.
    generation: AtomicU64,
    /// One-shot engine repair (2026-09-15): set when the voice bootstrap
    /// has been run in response to `/health` reporting
    /// `engines.kokoro == false`. At most ONE repair per app run; the
    /// day-marker file bounds it to one per calendar day across runs.
    repair_tried: AtomicBool,
    /// Set when we've already logged the loud "repair didn't fix it" WARN,
    /// so a broken-after-repair server warns once, not every watch cycle.
    repair_warned: AtomicBool,
}

pub fn start(app: &AppHandle) {
    #[cfg(all(desktop, not(windows)))]
    {
        app.manage(VoiceServerState::default());
        tauri::async_runtime::spawn(supervise(app.clone()));
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
            state.shutdown.store(true, Ordering::SeqCst);
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
fn shutdown_flag(app: &AppHandle) -> bool {
    app.try_state::<VoiceServerState>()
        .map(|s| s.shutdown.load(Ordering::SeqCst))
        .unwrap_or(true)
}

#[cfg(all(desktop, not(windows)))]
fn generation(app: &AppHandle) -> u64 {
    app.try_state::<VoiceServerState>()
        .map(|s| s.generation.load(Ordering::SeqCst))
        .unwrap_or(u64::MAX)
}

/// Persist the ownership token as a sibling of the app-data dir (NOT inside
/// the per-bundle dir): `~/Library/Application Support/palimpsest-voice-token`
/// on macOS. A sibling keeps the file in the same "directory family" the app
/// already uses for its data while letting a respawned app instance (possibly
/// a different bundle id during dev) match a server it started earlier.
#[cfg(all(desktop, not(windows)))]
fn token_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|dir| dir.parent().map(|parent| parent.join("palimpsest-voice-token")))
}

/// 16 random bytes from the OS as 32 hex chars. No `rand` crate: this code
/// path is already gated `not(windows)`, so `/dev/urandom` is always there.
#[cfg(all(desktop, not(windows)))]
fn random_hex_16() -> Option<String> {
    use std::io::Read;
    let mut buf = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .ok()?
        .read_exact(&mut buf)
        .ok()?;
    Some(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Read the persisted token, creating it if absent or malformed. Falls back
/// to an ephemeral per-process token when the file can't be used: within
/// this app run ownership still works (the supervisor keeps the token in
/// memory), only cross-launch adoption degrades.
#[cfg(all(desktop, not(windows)))]
fn load_or_create_token(app: &AppHandle) -> Option<String> {
    if let Some(path) = token_file_path(app) {
        if let Ok(existing) = std::fs::read_to_string(&path) {
            let trimmed = existing.trim();
            if trimmed.len() == 32 && trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Some(trimmed.to_string());
            }
            eprintln!(
                "voice server: token file {} is malformed — regenerating",
                path.display()
            );
        }
        if let Some(token) = random_hex_16() {
            if let Err(e) = std::fs::write(&path, &token) {
                eprintln!(
                    "voice server: could not persist token to {}: {e}",
                    path.display()
                );
            }
            return Some(token);
        }
    }
    random_hex_16()
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
/// import the voice stack — including `misaki.en`, because top-level
/// `import misaki` DEFERS its submodule deps (spacy, num2words, ...). The
/// old weak probe (`import misaki`) let a venv missing those pass, get
/// chosen, and then every Kokoro request 500'd with Broken pipe while
/// /health stayed green (owner's incident, 2026-09-15). Probing per
/// candidate beats an existence check — a wrong interpreter spawns, dies
/// on import, and we poll a dead port for 120 s. The hpub/marker venvs are
/// deliberately NOT candidates: they lack mlx-audio.
#[cfg(all(desktop, not(windows)))]
fn voice_imports_ok(python: &str) -> bool {
    std::process::Command::new(python)
        .args(["-c", "import mlx_audio, mlx_whisper, huggingface_hub, misaki.en"])
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

/// Bare "is anything answering /health" probe (token-agnostic).
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

/// Outcome of the ownership probe against `/health`.
#[cfg(all(desktop, not(windows)))]
enum Probe {
    /// Answering with our token — ours (adopt, don't spawn).
    Ours,
    /// Answering without a token field, with a foreign token, or with a
    /// non-JSON body — a zombie or manual server (evict, respawn).
    Foreign,
    /// Nothing answered (spawn).
    Quiet,
}

#[cfg(all(desktop, not(windows)))]
async fn probe(token: &str) -> Probe {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    else {
        return Probe::Quiet;
    };
    let Ok(res) = client.get(HEALTH_URL).send().await else {
        return Probe::Quiet;
    };
    if !res.status().is_success() {
        // Something occupies the port but doesn't speak our health protocol.
        return Probe::Foreign;
    }
    let Ok(body) = res.text().await else {
        return Probe::Foreign;
    };
    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(json) => match json.get("token").and_then(|t| t.as_str()) {
            Some(found) if found == token => Probe::Ours,
            // No `token` field at all: a server started without `--token`
            // (manual or spawned by an older app build) — never adopt.
            _ => Probe::Foreign,
        },
        Err(_) => Probe::Foreign,
    }
}

/// Kill every pid answering :8737 (the `lsof` pattern used everywhere in
/// this module). Returns the evicted pids for logging.
#[cfg(all(desktop, not(windows)))]
fn evict_foreign_pids() -> Vec<u32> {
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
    pids
}

/// Wait (up to 10 s) for the port to actually go quiet after an eviction.
#[cfg(all(desktop, not(windows)))]
async fn wait_port_quiet() {
    let mut waited = Duration::ZERO;
    while health_up().await && waited < Duration::from_secs(10) {
        tokio::time::sleep(Duration::from_millis(250)).await;
        waited += Duration::from_millis(250);
    }
}

/// Resolve a bundled resource: installed bundle first, dev tree fallback.
/// Same pattern as onboarding.rs (which runs the same script on demand).
#[cfg(all(desktop, not(windows)))]
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

/// Today's date as YYYY-MM-DD (UTC), computed from the Unix epoch with the
/// standard civil-from-days conversion — no chrono dependency. Only used
/// for the once-per-day engine-repair marker, so UTC vs local drift is
/// irrelevant (the marker compares against itself).
#[cfg(all(desktop, not(windows)))]
fn today_string() -> String {
    let days = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86_400) as i64;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let y = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365 + era * 400;
    let doy = doe - (365 * y + y / 4 - y / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// Engine-repair day marker, a sibling of the token file:
/// `~/Library/Application Support/palimpsest-voice-repair` holds the
/// YYYY-MM-DD date of the last repair. Bounds bootstrap re-runs to one per
/// calendar day even across app relaunches.
#[cfg(all(desktop, not(windows)))]
fn repair_marker_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|dir| dir.parent().map(|parent| parent.join("palimpsest-voice-repair")))
}

#[cfg(all(desktop, not(windows)))]
fn repair_ran_today(app: &AppHandle) -> bool {
    repair_marker_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|contents| contents.trim() == today_string())
        .unwrap_or(false)
}

#[cfg(all(desktop, not(windows)))]
fn mark_repair_today(app: &AppHandle) {
    if let Some(path) = repair_marker_path(app) {
        if let Err(e) = std::fs::write(&path, today_string()) {
            eprintln!(
                "voice server: could not write repair marker to {}: {e}",
                path.display()
            );
        }
    }
}

/// Fetch the full /health body as JSON. Unlike `health_up` (status only)
/// and `probe` (token only), this exposes the engine self-test fields the
/// server added on 2026-09-15.
#[cfg(all(desktop, not(windows)))]
async fn fetch_health_json() -> Option<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?;
    let body = client.get(HEALTH_URL).send().await.ok()?.text().await.ok()?;
    serde_json::from_str(&body).ok()
}

/// Run the idempotent voice bootstrap script, streaming its output to the
/// app log (same invocation pattern as onboarding.rs). Hard 10-minute cap.
#[cfg(all(desktop, not(windows)))]
async fn run_voice_bootstrap(app: &AppHandle) -> Result<(), String> {
    let script = resolve_resource(app, "resources/tts/bootstrap_voice.sh")?;
    log::info!("voice server: running bootstrap repair via {}", script.display());
    let mut child = tokio::process::Command::new("/bin/bash")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn voice bootstrap: {e}"))?;
    pump_to_log(child.stdout.take()).await;
    pump_to_log(child.stderr.take()).await;
    let status = tokio::time::timeout(REPAIR_TIMEOUT, child.wait())
        .await
        .map_err(|_| "voice bootstrap timed out after 10 minutes".to_string())?
        .map_err(|e| format!("voice bootstrap wait failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("voice bootstrap exited with {:?}", status.code()))
    }
}

/// One-shot engine self-repair (2026-09-15 incident: the chosen venv
/// passed the old weak `import misaki` probe but lacked spacy/num2words,
/// so /health was green while every Kokoro request 500'd with Broken
/// pipe — the user sat with silently-dead voices). Called by the
/// supervisor each time a server first passes health (owned or adopted):
///
///   1. Fetch /health once; if `engines.kokoro` is absent (pre-patch
///      server) or true, do nothing.
///   2. Guards: at most ONE repair per app run (`repair_tried`) and one
///      per calendar day (the `palimpsest-voice-repair` marker file).
///   3. Run bootstrap_voice.sh (idempotent; up to 10 min), then mark today.
///   4. Owned child: kill it so the supervisor respawns against the
///      repaired venv and re-checks. Adopted server: no handle to kill —
///      bootstrap repairs the venv in place; the watch strikes cycle the
///      process later.
///   5. If kokoro is STILL false on the next healthy pass, log one loud
///      WARN and stop trying (the narration layer's Edge-voice fallback
///      covers playback).
#[cfg(all(desktop, not(windows)))]
async fn engine_self_repair(app: &AppHandle, adopted: bool) {
    if shutdown_flag(app) {
        return;
    }
    let Some(kokoro_ok) = fetch_health_json()
        .await
        .and_then(|json| json.get("engines")?.get("kokoro")?.as_bool())
    else {
        return; // old server without the engine self-test, or unparseable
    };
    let Some(state) = app.try_state::<VoiceServerState>() else {
        return;
    };
    if state.repair_tried.load(Ordering::SeqCst) {
        // The repair already ran this app run. Still broken -> one loud
        // WARN per run, then stop trying; Edge-voice fallback covers it.
        if !kokoro_ok && !state.repair_warned.swap(true, Ordering::SeqCst) {
            log::warn!(
                "voice server: ENGINE REPAIR RAN BUT kokoro IS STILL BROKEN — local voices will fail; falling back to Edge voices (see bootstrap log above)"
            );
        }
        return;
    }
    if kokoro_ok || repair_ran_today(app) {
        return;
    }

    state.repair_tried.store(true, Ordering::SeqCst);
    log::warn!(
        "voice server: /health reports engines.kokoro=false — venv is missing voice deps (2026-09-15 incident); running one-shot bootstrap repair"
    );
    match run_voice_bootstrap(app).await {
        Ok(()) => {
            mark_repair_today(app);
            log::info!("voice server: bootstrap repair finished");
        }
        Err(e) => {
            log::error!("voice server: bootstrap repair failed: {e}");
            return;
        }
    }

    if adopted {
        // Not our child: no handle to kill. The venv is repaired on disk;
        // the next watch-strike death respawns against it. Don't evict a
        // healthy-answering server we adopted — that would drop an
        // otherwise-working Qwen voice mid-session.
        log::info!("voice server: adopted server keeps running; repaired venv applies after its next restart");
        return;
    }
    // Owned child: kill it so the supervisor respawns it against the
    // repaired venv and the next healthy pass re-checks engines.kokoro.
    let held = app
        .try_state::<VoiceServerState>()
        .and_then(|state| state.child.lock().ok().and_then(|mut guard| guard.take()));
    if let Some(mut child) = held {
        log::info!("voice server: killing owned child so it respawns against the repaired venv");
        let _ = child.start_kill();
        let _ = child.wait().await;
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

/// Spawn the bundled server with our ownership token. The argv is part of
/// the coordination contract with qwen_server.py:
///   `python qwen_server.py --token <hex> --port 8737`
#[cfg(all(desktop, not(windows)))]
async fn spawn_child(python: &str, script: &Path, token: &str) -> Result<tokio::process::Child, String> {
    log::info!("voice server: starting {} via {}", script.display(), python);
    let mut child = tokio::process::Command::new(python)
        .arg(script)
        .args(["--token", token, "--port", &VOICE_PORT.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    pump_to_log(child.stdout.take()).await;
    pump_to_log(child.stderr.take()).await;
    Ok(child)
}

/// Hand a freshly spawned child to app-lifetime state. This must happen
/// before the supervisor waits on health: the spawning task returning must
/// not drop (and kill) the server.
#[cfg(all(desktop, not(windows)))]
fn store_child(app: &AppHandle, child: tokio::process::Child) {
    match app.try_state::<VoiceServerState>() {
        Some(state) => match state.child.lock() {
            Ok(mut guard) => *guard = Some(child),
            Err(_) => log::error!("voice server: state lock poisoned — child will not survive"),
        },
        None => log::error!("voice server: managed state missing — child will not survive"),
    }
}

/// Result of a watch / health-wait phase. `Resync` means
/// `restart_voice_server` bumped the generation mid-phase: abandon the phase
/// and let the supervisor re-probe from scratch (the restart kills and
/// respawns via the same supervisor loop — it never stores a child itself,
/// keeping a single spawner).
#[cfg(all(desktop, not(windows)))]
enum Phase {
    Healthy,
    Unhealthy,
    Shutdown,
    Resync,
}

/// Watch a server we consider up (owned child or adopted). Returns when it
/// dies, when shutdown begins, or when a restart bumps the generation.
#[cfg(all(desktop, not(windows)))]
async fn watch(app: &AppHandle) -> Phase {
    let start_gen = generation(app);
    let mut strikes = 0u32;
    loop {
        tokio::time::sleep(WATCH_POLL).await;
        if shutdown_flag(app) {
            return Phase::Shutdown;
        }
        if generation(app) != start_gen {
            return Phase::Resync;
        }
        // Reap the owned child if it has exited (also keeps it from
        // lingering as a zombie). Adopted servers have no child here; their
        // death is detected by the health strikes below.
        let exited = match app.try_state::<VoiceServerState>() {
            Some(state) => match state.child.lock() {
                Ok(mut guard) => match guard.as_mut() {
                    Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                    None => false,
                },
                Err(_) => false,
            },
            None => true,
        };
        if exited {
            let reaped = app
                .try_state::<VoiceServerState>()
                .and_then(|state| state.child.lock().ok().and_then(|mut guard| guard.take()));
            if let Some(mut child) = reaped {
                let _ = child.wait().await;
            }
            return Phase::Unhealthy;
        }
        if health_up().await {
            strikes = 0;
        } else {
            strikes += 1;
            if strikes >= WATCH_STRIKES {
                return Phase::Unhealthy;
            }
        }
    }
}

/// Wait (up to `HEALTH_LIMIT`) for a just-spawned server to answer /health.
#[cfg(all(desktop, not(windows)))]
async fn wait_healthy(app: &AppHandle) -> Phase {
    let start_gen = generation(app);
    let mut waited = Duration::ZERO;
    while waited < HEALTH_LIMIT {
        if shutdown_flag(app) {
            return Phase::Shutdown;
        }
        if generation(app) != start_gen {
            return Phase::Resync;
        }
        if health_up().await {
            return Phase::Healthy;
        }
        tokio::time::sleep(HEALTH_POLL).await;
        waited += HEALTH_POLL;
    }
    Phase::Unhealthy
}

/// The app-owned server supervisor. Sole spawner: it adopts or evicts on
/// probe, spawns with the ownership token, watches the result, and on an
/// unexpected death respawns with exponential backoff (max 5 attempts).
#[cfg(all(desktop, not(windows)))]
async fn supervise(app: AppHandle) {
    let Some(token) = load_or_create_token(&app) else {
        log::warn!("voice server: cannot establish ownership token — skipping auto-start");
        return;
    };

    let mut attempts = 0u32;
    let mut backoff = BACKOFF_START;
    loop {
        if shutdown_flag(&app) {
            return;
        }

        // Adopt-or-evict probe: never spawn on top of a server we don't own.
        match probe(&token).await {
            Probe::Ours => {
                eprintln!("voice server: adopted existing server (token match) — no spawn needed");
                log::info!("voice server: adopted existing server (token match)");
                engine_self_repair(&app, true).await;
                match watch(&app).await {
                    Phase::Shutdown => return,
                    Phase::Resync => continue,
                    Phase::Healthy | Phase::Unhealthy => {
                        eprintln!("voice server: adopted server went away — respawning ours");
                        log::warn!("voice server: adopted server went away — respawning ours");
                    }
                }
            }
            Probe::Foreign => {
                eprintln!(
                    "voice server: foreign/zombie server on :8737 (token missing or mismatch) — evicting"
                );
                log::info!("voice server: foreign/zombie server on :8737 — evicting");
                let pids = evict_foreign_pids();
                if !pids.is_empty() {
                    log::info!("voice server: evicted {} foreign pid(s): {:?}", pids.len(), pids);
                }
                wait_port_quiet().await;
                // Loop around: the re-probe should now find the port quiet.
                continue;
            }
            Probe::Quiet => {}
        }

        // Nothing (ours) answers — spawn our own.
        let (Ok(script), Some(python)) = (resolve_server_script(&app), resolve_python()) else {
            log::warn!("voice server: no working interpreter or script — skipping auto-start");
            return;
        };
        match spawn_child(&python, &script, &token).await {
            Ok(child) => {
                store_child(&app, child);
                match wait_healthy(&app).await {
                    Phase::Shutdown => return,
                    Phase::Resync => continue,
                    Phase::Healthy => {
                        eprintln!("voice server: healthy — watching");
                        log::info!("voice server: healthy — watching");
                        attempts = 0;
                        backoff = BACKOFF_START;
                        engine_self_repair(&app, false).await;
                        match watch(&app).await {
                            Phase::Shutdown => return,
                            Phase::Resync => continue,
                            Phase::Healthy | Phase::Unhealthy => {
                                eprintln!(
                                    "voice server: child exited unexpectedly — restarting (attempt {})",
                                    attempts + 1
                                );
                                log::warn!("voice server: child exited unexpectedly — restarting");
                            }
                        }
                    }
                    Phase::Unhealthy => {
                        eprintln!("voice server: spawned but never became healthy");
                        log::warn!("voice server: no health after {}s", HEALTH_LIMIT.as_secs());
                    }
                }
            }
            Err(e) => {
                log::warn!("voice server: {e}");
            }
        }

        attempts += 1;
        if attempts >= MAX_RESTART_ATTEMPTS {
            eprintln!(
                "voice server: giving up after {attempts} failed attempts — leaving it down this session"
            );
            log::error!("voice server: giving up after {attempts} failed attempts");
            return;
        }
        eprintln!(
            "voice server: respawn attempt {} in {}s",
            attempts,
            backoff.as_secs()
        );
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}

/// Restart the local voice server. Called from the narration layer when
/// synthesis starts failing while `/health` still answers — a half-dead
/// MLX stack: the stdlib HTTP server survives, but every generation
/// EPIPEs under it (observed 2026-09-14 after a sleep/wake cycle, ~4 h
/// into the server's life). The narration controller can't detect that
/// from a health probe, so the client counts consecutive synthesis
/// failures and asks for a restart.
///
/// Ownership cases handled: the child we spawned this session (killed via
/// the stored handle), a token-matching server adopted at launch, AND a
/// zombie answering the port without a token (evicted via lsof) — every
/// case ends with the supervisor respawning a token-verified server. This
/// command never stores the new child itself: the supervisor stays the
/// sole spawner, so its crash-restart bookkeeping can't double-spawn.
#[cfg(all(desktop, not(windows)))]
#[tauri::command]
pub async fn restart_voice_server(app: AppHandle) -> Result<bool, String> {
    log::info!("voice server: restart requested");

    // Bump the generation FIRST so the supervisor abandons any in-flight
    // health-wait/watch promptly instead of racing our kill below.
    if let Some(state) = app.try_state::<VoiceServerState>() {
        state.generation.fetch_add(1, Ordering::SeqCst);
    }

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

    // Evict anything else answering :8737 (adopted or zombie — the launch
    // probe may have adopted a token-matching server we hold no handle to).
    let pids = evict_foreign_pids();
    if !pids.is_empty() {
        log::info!("voice server: evicted {} foreign pid(s): {:?}", pids.len(), pids);
    }
    wait_port_quiet().await;

    // The supervisor notices the generation bump within WATCH_POLL, finds
    // the port quiet, and spawns a fresh token-verified server. We only
    // wait for health to report the result.
    let mut waited = Duration::ZERO;
    while waited < Duration::from_secs(60) {
        if shutdown_flag(&app) {
            return Ok(false);
        }
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
