/**
 * Learner-profile contract tests (Workbench 2.x W2.4) — tolerant parsing,
 * per-reader persistence over the AppService file API, and the additive
 * prompt-line cap. (s5-bridge-profile.md Part 3.)
 */
import { describe, it, expect } from 'vitest';
import {
  LEARNER_PROFILE_PATH,
  PROFILE_OWNED_CONCEPT_MAX,
  PROFILE_PROBE_MAX,
  PROFILE_PROBE_MIN,
  emptyProfile,
  isEmptyProfile,
  loadProfile,
  normalizeProfile,
  profileLinesForPrompt,
  saveProfile,
  type LearnerProfile,
} from '@/services/professor/learnerProfile';
import type { AppService } from '@/types/system';

describe('normalizeProfile', () => {
  it('garbage in, empty out — invalid fields dropped individually', () => {
    expect(normalizeProfile(null)).toEqual({});
    expect(normalizeProfile('nonsense')).toEqual({});
    expect(normalizeProfile(42)).toEqual({});

    const wrongTypes = normalizeProfile({
      pace: 'breakneck',
      voice: 7,
      probe_level: PROFILE_PROBE_MAX + 3, // 9 — out of range
      owned_concepts: 'not-an-array',
    });
    expect(wrongTypes).toEqual({});

    // String/frac probe levels degrade to the default rather than coerce.
    expect(normalizeProfile({ probe_level: '4' })).toEqual({});
    expect(normalizeProfile({ probe_level: 0.5 })).toEqual({});
    expect(isEmptyProfile(emptyProfile())).toBe(true);
  });

  it('keeps valid fields, slugs + dedupes concepts', () => {
    const p = normalizeProfile({
      pace: 'steady',
      voice: 'plain',
      probe_level: 4,
      owned_concepts: ['Associated Primes!', 'associated_primes', '  Direct  Limits ', 9, ''],
    });
    expect(p).toEqual({
      pace: 'steady',
      voice: 'plain',
      probe_level: 4,
      owned_concepts: ['associated_primes', 'direct_limits'],
    });
    expect(normalizeProfile({ probe_level: PROFILE_PROBE_MIN }).probe_level).toBe(1);
  });
});

/** In-memory AppService stub over a Map — the professor-learner.test.ts idiom. */
const makeStub = (initial?: Map<string, string>) => {
  const files = initial ?? new Map<string, string>();
  return {
    files,
    service: {
      readFile: async (path: string) => files.get(path) ?? Promise.reject(new Error('missing')),
      writeFile: async (path: string, _base: unknown, content: string) => {
        files.set(path, content);
      },
    } as unknown as AppService,
  };
};

describe('profile persistence', () => {
  it('round-trips a full profile through saveProfile/loadProfile', async () => {
    const { service, files } = makeStub();
    const profile: LearnerProfile = {
      pace: 'deliberate',
      voice: 'playful',
      probe_level: 3,
      owned_concepts: ['associated_primes'],
    };
    await saveProfile(service, profile);
    expect(files.has(LEARNER_PROFILE_PATH)).toBe(true);
    expect(await loadProfile(service)).toEqual(profile);
  });

  it('a corrupt file loads as the empty profile without throwing', async () => {
    const { service } = makeStub(new Map([[LEARNER_PROFILE_PATH, '{not json']]));
    expect(await loadProfile(service)).toEqual({});
    const missing = makeStub().service;
    expect(await loadProfile(missing)).toEqual({});
  });
});

describe('profileLinesForPrompt', () => {
  it('empty profile → no lines; full profile → capped at 5 lines', () => {
    expect(profileLinesForPrompt({})).toEqual([]);
    const lines = profileLinesForPrompt({
      pace: 'swift',
      voice: 'formal',
      probe_level: 5,
      owned_concepts: ['limits', 'primes'],
    });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[0]).toContain('study profile');
    expect(lines.join('\n')).toContain('Bloom 5');
    expect(lines.join('\n')).toContain('already own: limits, primes');
  });

  it('caps the owned-concepts line at PROFILE_OWNED_CONCEPT_MAX names', () => {
    const many = Array.from({ length: 12 }, (_, i) => `concept_${i}`);
    const lines = profileLinesForPrompt({ owned_concepts: many });
    const ownedLine = lines.find((l) => l.includes('already own'))!;
    const names = ownedLine.split(':')[1]!.split(',').length;
    expect(names).toBeLessThanOrEqual(PROFILE_OWNED_CONCEPT_MAX);
    expect(ownedLine).toContain('concept_0');
  });
});
