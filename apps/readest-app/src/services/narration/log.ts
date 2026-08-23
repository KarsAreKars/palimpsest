/**
 * Narration logging bridge.
 *
 * The desktop app's webview console is invisible to us — twice already a
 * desktop-only narration bug needed the player's own words (silent provider
 * fallback, controls that never reached the player). These helpers mirror
 * every narration log line into the Rust log file (Readest.log via
 * tauri-plugin-log) when running under Tauri, and to the plain console
 * everywhere else.
 */
import { info as tInfo, warn as tWarn } from '@tauri-apps/plugin-log';
import { isTauriAppPlatform } from '@/services/environment';

export const nlog = (msg: string): void => {
  console.info(msg);
  if (isTauriAppPlatform()) void tInfo(msg).catch(() => {});
};

export const nwarn = (msg: string, err?: unknown): void => {
  console.warn(msg, err);
  if (isTauriAppPlatform()) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
    void tWarn(`${msg}${detail ? ' — ' + detail : ''}`).catch(() => {});
  }
};
