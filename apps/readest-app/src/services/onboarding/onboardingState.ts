/**
 * Palimpsest first-run onboarding — pure decision helpers.
 *
 * Split from onboardingService (which talks to stores/Tauri) so the whole
 * state machine is unit-testable without mocking the universe. The overlay,
 * the sample-book installer, and the tests all reason in these terms.
 */
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';
import type { SystemSettings } from '@/types/settings';

/** The three setup beats plus the closing card. */
export type OnboardingBeat = 'welcome' | 'voice' | 'ai' | 'open';

export const ONBOARDING_BEATS: OnboardingBeat[] = ['welcome', 'voice', 'ai', 'open'];

export const nextBeat = (beat: OnboardingBeat): OnboardingBeat => {
  const i = ONBOARDING_BEATS.indexOf(beat);
  return ONBOARDING_BEATS[Math.min(i + 1, ONBOARDING_BEATS.length - 1)]!;
};

export const prevBeat = (beat: OnboardingBeat): OnboardingBeat => {
  const i = ONBOARDING_BEATS.indexOf(beat);
  return ONBOARDING_BEATS[Math.max(i - 1, 0)]!;
};

/** Settings start life as `{}` in the store — never treat that as "not
 *  onboarded" or the overlay would flash before settings load. */
export const areSettingsLoaded = (settings: SystemSettings | null | undefined): boolean =>
  !!settings && Object.keys(settings).length > 0;

export const shouldShowOnboarding = (settings: SystemSettings | null | undefined): boolean =>
  areSettingsLoaded(settings) && !settings?.onboarded;

/** The sample book is installed at most once, ever: the flag survives the
 *  user deleting the book, so we never re-appear on the shelf uninvited. */
export const shouldInstallSampleBook = (settings: SystemSettings | null | undefined): boolean =>
  shouldShowOnboarding(settings) && !settings?.sampleBookInstalledAt;

export interface OnboardingAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Save through the exact same settings path as Settings → AI (AIPanel):
 *  the OpenAI-compatible ("openrouter") provider, enabled. */
export const buildOnboardingAiSettings = (
  current: AISettings | undefined,
  cfg: OnboardingAiConfig,
): AISettings => ({
  ...(current ?? DEFAULT_AI_SETTINGS),
  enabled: true,
  provider: 'openrouter',
  openrouterApiKey: cfg.apiKey,
  openrouterBaseUrl: cfg.baseUrl.replace(/\/+$/, ''),
  openrouterModel: cfg.model,
});

/** True when a config is complete enough to test/save. Model is optional
 *  (the endpoint may have a server-side default). */
export const isAiConfigComplete = (cfg: OnboardingAiConfig): boolean =>
  cfg.apiKey.trim().length > 0 && /^https?:\/\/.+/.test(cfg.baseUrl.trim());

/**
 * The Beat-3 TEST: a 1-token chat completion against the configured
 * OpenAI-compatible endpoint. `fetchImpl` is injected so tests don't touch
 * the network.
 */
export const testChatCompletion = async (
  fetchImpl: typeof fetch,
  cfg: OnboardingAiConfig,
): Promise<boolean> => {
  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model || 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Ping.' }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
};
