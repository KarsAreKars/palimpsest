import { describe, expect, test, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { SystemSettings } from '@/types/settings';
import {
  buildOnboardingAiSettings,
  isAiConfigComplete,
  nextBeat,
  ONBOARDING_BEATS,
  prevBeat,
  shouldInstallSampleBook,
  shouldShowOnboarding,
  testChatCompletion,
} from '@/services/onboarding/onboardingState';

const loadedSettings = (over: Partial<SystemSettings> = {}): SystemSettings =>
  ({ globalReadSettings: {} as never, ...over }) as SystemSettings;

describe('onboarding state machine', () => {
  test('walks forward through welcome → voice → ai → open and stays at open', () => {
    let beat = ONBOARDING_BEATS[0]!;
    const seen = [beat];
    for (let i = 0; i < ONBOARDING_BEATS.length + 1; i++) {
      beat = nextBeat(beat);
      seen.push(beat);
    }
    expect(seen).toEqual(['welcome', 'voice', 'ai', 'open', 'open', 'open']);
  });

  test('walks backward and stays at welcome', () => {
    expect(prevBeat('welcome')).toBe('welcome');
    expect(prevBeat(prevBeat('voice'))).toBe('welcome');
  });

  test('empty (not-yet-loaded) settings never trigger the overlay', () => {
    expect(shouldShowOnboarding({} as SystemSettings)).toBe(false);
    expect(shouldShowOnboarding(null)).toBe(false);
    expect(shouldShowOnboarding(undefined)).toBe(false);
  });

  test('shows onboarding only when loaded and missing the flag', () => {
    expect(shouldShowOnboarding(loadedSettings())).toBe(true);
    expect(shouldShowOnboarding(loadedSettings({ onboarded: true }))).toBe(false);
  });
});

describe('sample book install gating', () => {
  test('installs at most once, even after the user deletes the book', () => {
    expect(shouldInstallSampleBook(loadedSettings())).toBe(true);
    expect(shouldInstallSampleBook(loadedSettings({ sampleBookInstalledAt: 1726000000000 }))).toBe(
      false,
    );
    // Deleted book + completed onboarding -> never resurfaces.
    expect(
      shouldInstallSampleBook(
        loadedSettings({ onboarded: true, sampleBookInstalledAt: 1726000000000 }),
      ),
    ).toBe(false);
  });
});

describe('buildOnboardingAiSettings', () => {
  test('writes the OpenAI-compatible provider through the Settings → AI shape', () => {
    const next = buildOnboardingAiSettings(
      { ...DEFAULT_AI_SETTINGS, provider: 'ollama' },
      { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1/', model: 'gpt-4o-mini' },
    );
    expect(next.enabled).toBe(true);
    expect(next.provider).toBe('openrouter');
    expect(next.openrouterApiKey).toBe('sk-test');
    expect(next.openrouterBaseUrl).toBe('https://api.openai.com/v1'); // trailing slash trimmed
    expect(next.openrouterModel).toBe('gpt-4o-mini');
  });

  test('defaults from DEFAULT_AI_SETTINGS when no AI settings exist yet', () => {
    const next = buildOnboardingAiSettings(undefined, {
      apiKey: 'k',
      baseUrl: 'https://example.com/v1',
      model: '',
    });
    expect(next.spoilerProtection).toBe(DEFAULT_AI_SETTINGS.spoilerProtection);
    expect(next.provider).toBe('openrouter');
  });
});

describe('isAiConfigComplete', () => {
  test('requires a key and an http(s) base URL; model is optional', () => {
    expect(
      isAiConfigComplete({ apiKey: ' k ', baseUrl: 'https://api.openai.com/v1', model: '' }),
    ).toBe(true);
    expect(
      isAiConfigComplete({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: '' }),
    ).toBe(false);
    expect(isAiConfigComplete({ apiKey: 'k', baseUrl: 'not-a-url', model: '' })).toBe(false);
  });
});

describe('testChatCompletion', () => {
  const cfg = { apiKey: 'sk-x', baseUrl: 'https://api.openai.com/v1/', model: 'm' };

  test('sends a 1-token chat completion and passes on HTTP 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    await expect(testChatCompletion(fetchMock as unknown as typeof fetch, cfg)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as { max_tokens: number; model: string };
    expect(body.max_tokens).toBe(1);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-x');
    expect(body.model).toBe('m');
  });

  test('fails on HTTP error and on network failure, without throwing', async () => {
    const httpErr = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(testChatCompletion(httpErr as unknown as typeof fetch, cfg)).resolves.toBe(false);
    const netErr = vi.fn().mockRejectedValue(new TypeError('network down'));
    await expect(testChatCompletion(netErr as unknown as typeof fetch, cfg)).resolves.toBe(false);
  });
});
