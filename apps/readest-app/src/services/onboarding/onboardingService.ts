/**
 * Palimpsest first-run onboarding — side-effectful half.
 *
 * Owns the two things the overlay needs that touch the outside world:
 *   * sample-book installation — pulls the bundled .hpub bytes over IPC,
 *     builds a File, and runs the REGULAR import path (ingestFile →
 *     importBook → updateBooks) so the sample lands exactly like a
 *     completed import: unzipped view layer, sidecars next to it, cover,
 *     shelf registration. make_hpub is never re-run (manifest.json ships
 *     in the package, so the text-layer extractor skips the book).
 *   * completion — writes the `onboarded` flag through the settings store
 *     (the same save path as Settings → AI, whose keys Beat 3 also writes).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { ingestFile } from '@/services/ingestService';
import { isTauriAppPlatform } from '@/services/environment';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import {
  buildOnboardingAiSettings,
  isAiConfigComplete,
  shouldInstallSampleBook,
  type OnboardingAiConfig,
} from './onboardingState';

// The flags live on SystemSettings but the interface belongs to types/,
// outside this lane — extend it here via declaration merging instead.
declare module '@/types/settings' {
  interface SystemSettings {
    /** First-run onboarding completed (or explicitly skipped). */
    onboarded?: boolean;
    /** Epoch ms of the one-time sample-book install. Never reset, so a
     *  deleted sample book is never reinstalled. */
    sampleBookInstalledAt?: number;
  }
}

/** Persist `onboarded` — called on completion or explicit skip. */
export const completeOnboarding = async (envConfig: EnvConfigType): Promise<void> => {
  const store = useSettingsStore.getState();
  const next = { ...store.settings, onboarded: true };
  store.setSettings(next);
  await store.saveSettings(envConfig, next);
};

/** Beat 3 SAVE: write the OpenAI-compatible config through the same store
 *  path as Settings → AI. */
export const saveOnboardingAiConfig = async (
  envConfig: EnvConfigType,
  cfg: OnboardingAiConfig,
): Promise<void> => {
  const store = useSettingsStore.getState();
  const next = {
    ...store.settings,
    aiSettings: buildOnboardingAiSettings(store.settings?.aiSettings, cfg),
  };
  store.setSettings(next);
  await store.saveSettings(envConfig, next);
};

/**
 * Install the bundled sample book exactly once. No-ops unless this is a
 * first run without the install marker; returns whether a book was added.
 */
export const installSampleBook = async (
  envConfig: EnvConfigType,
  appService: AppService,
): Promise<boolean> => {
  const settings = useSettingsStore.getState().settings;
  if (!isTauriAppPlatform() || !shouldInstallSampleBook(settings)) return false;
  try {
    const raw = await invoke<ArrayBuffer | number[]>('onboarding_sample_book');
    const buffer = raw instanceof ArrayBuffer ? raw : new Uint8Array(raw as number[]).buffer;
    const file = new File([buffer], 'sample-book.hpub', { type: 'application/zip' });
    const book = await ingestFile(
      { file, books: useLibraryStore.getState().library },
      { appService, settings, isLoggedIn: false },
    );
    if (!book) return false;
    await useLibraryStore.getState().updateBooks(envConfig, [book]);
    // Marker for "once, ever": set only after a successful registration, and
    // fold into the latest settings — the import may have taken a while.
    const store = useSettingsStore.getState();
    const next = { ...store.settings, sampleBookInstalledAt: Date.now() };
    store.setSettings(next);
    await store.saveSettings(envConfig, next);
    return true;
  } catch (e) {
    console.warn('sample book install failed', e);
    return false;
  }
};

export interface VoiceBootstrapProgress {
  line: string;
}

/**
 * Run the bundled voice bootstrap (idempotent). Streams script output lines
 * to `onLine` as they arrive; resolves when the script exits 0.
 */
export const runVoiceBootstrap = async (onLine: (line: string) => Promise<void>): Promise<void> => {
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<VoiceBootstrapProgress>('voice-bootstrap-progress', async (ev) => {
      await onLine(ev.payload.line);
    });
    await invoke('onboarding_run_voice_bootstrap');
  } finally {
    unlisten?.();
  }
};

export type { OnboardingAiConfig };
export { isAiConfigComplete };
