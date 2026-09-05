//! Professor window screenshot (ClickyX-parity capture, least-privilege scope).
//!
//! ClickyX captures the whole screen because it has no idea what the user is
//! looking at. We know — the reader window — so we capture ONLY our own
//! process's windows (matched by pid), preferring the focused one. That gets
//! the user's highlights, selection, and ink as they literally see them,
//! without hoovering unrelated screen content (axiom 4: the user owns
//! everything — least-privilege capture).
//!
//! The frame is evidence, never the addressing system: annotations still
//! reference manifest block ids and are validated/drawn exactly as before
//! (anchors unchanged).
//!
//! Failure modes are additive-only: on macOS without Screen Recording
//! permission (TCC) the capture errors and the frontend silently degrades
//! to the A8 page-image path — never an error surface in the UI.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::ImageEncoder as _;

/// ClickyX parity: neither dimension exceeds 1280px (vision tokens scale
/// with pixels; 1280px reads fine for tutoring).
const MAX_DIM: u32 = 1280;

#[tauri::command]
pub fn capture_window_screenshot() -> Result<String, String> {
    let pid = std::process::id();
    let mut own: Vec<xcap::Window> = xcap::Window::all()
        .map_err(|e| format!("list windows: {e}"))?
        .into_iter()
        .filter(|w| w.pid().map(|p| p == pid).unwrap_or(false))
        .collect();
    if own.is_empty() {
        return Err("no application window found".to_string());
    }
    // Prefer the focused window (the reader the user just spoke to); fall
    // back to the largest of ours when focus info is unavailable.
    own.sort_by_key(|w| {
        let focused = w.is_focused().unwrap_or(false);
        let area = w.width().unwrap_or(0) as u64 * w.height().unwrap_or(0) as u64;
        (!focused, std::cmp::Reverse(area))
    });
    let img = own[0]
        .capture_image()
        .map_err(|e| format!("capture (Screen Recording permission granted?): {e}"))?;

    let (w, h) = (img.width(), img.height());
    let scale = (MAX_DIM as f32 / w.max(h) as f32).min(1.0);
    let resized = if scale < 1.0 {
        image::imageops::resize(
            &img,
            ((w as f32 * scale).round() as u32).max(1),
            ((h as f32 * scale).round() as u32).max(1),
            image::imageops::FilterType::Triangle,
        )
    } else {
        img
    };

    let mut buf = std::io::Cursor::new(Vec::new());
    image::codecs::png::PngEncoder::new(&mut buf)
        .write_image(
            resized.as_raw(),
            resized.width(),
            resized.height(),
            image::ExtendedColorType::Rgba8.into(),
        )
        .map_err(|e| format!("encode png: {e}"))?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(buf.into_inner())
    ))
}
