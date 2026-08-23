/**
 * HP-4 contract tests — the question log, Bloom tracker, stuck detection,
 * meta-tag parsing, and the context-pack/prompt surfaces they feed.
 * (hey_prof plan §6/§7, acceptance: "asking about the same concept 3×
 * triggers a strategy change + review offer".)
 */
import { describe, it, expect } from 'vitest';
import {
  applyExchange,
  emptyLearner,
  isStuck,
  stuckConcepts,
  stuckNoteForPrompt,
  normalizeQKind,
  type LearnerExchange,
} from '@/services/professor/learner';
import {
  parseAnnotations,
  stripAnnotationTags,
  slugifyConcept,
} from '@/services/professor/annotations';
import { buildContextPack } from '@/services/professor/contextPack';
import { buildProfessorUserMessage } from '@/services/professor/prompt';
import type { HpubManifest } from '@/services/narration';

const ex = (over: Partial<LearnerExchange>): LearnerExchange => ({
  ts: '2026-08-23T10:00:00.000Z',
  concept: 'associated_primes',
  page: 117,
  question_kind: 'why',
  question: 'why does the empty intersection matter?',
  resolved: true,
  ...over,
});

// --- Bloom tracker -----------------------------------------------------------

describe('applyExchange', () => {
  it('first contact starts at Bloom 2, asked 1', () => {
    const s = applyExchange(emptyLearner(), ex({}));
    expect(s.concept_states['associated_primes']).toMatchObject({ bloom: 2, asked: 1 });
  });

  it('re-asking the same concept drops the level (the explanation failed)', () => {
    let s = applyExchange(emptyLearner(), ex({}));
    s = applyExchange(s, ex({}));
    expect(s.concept_states['associated_primes']).toMatchObject({ bloom: 1, asked: 2 });
  });

  it('Bloom never drops below 1', () => {
    let s = emptyLearner();
    for (let i = 0; i < 5; i++) s = applyExchange(s, ex({}));
    expect(s.concept_states['associated_primes']!.bloom).toBe(1);
  });

  it('a resolved check-me raises the level, capped at 6', () => {
    let s = applyExchange(emptyLearner(), ex({}));
    s = applyExchange(s, ex({ concept: 'other_thing' })); // settles first as resolved
    s = applyExchange(s, ex({ question_kind: 'check-me', resolved: true }));
    expect(s.concept_states['associated_primes']!.bloom).toBe(3); // 2 → +1 for the pass
    for (let i = 0; i < 8; i++) {
      s = applyExchange(s, ex({ question_kind: 'check-me', resolved: true }));
    }
    expect(s.concept_states['associated_primes']!.bloom).toBeLessThanOrEqual(6);
  });

  it('settles the previous exchange resolved-flag by concept change', () => {
    let s = applyExchange(emptyLearner(), ex({}));
    s = applyExchange(s, ex({ concept: 'different_concept' }));
    expect(s.exchanges[0]!.resolved).toBe(true);
    s = applyExchange(s, ex({ concept: 'different_concept' }));
    expect(s.exchanges[1]!.resolved).toBe(false); // re-asked → it didn't land
  });
});

// --- Stuck detection (plan §6) ------------------------------------------------

describe('stuck detection', () => {
  it('fires at 3 asks of the same concept', () => {
    let s = emptyLearner();
    expect(isStuck(s, 'associated_primes')).toBe(false);
    s = applyExchange(s, ex({}));
    s = applyExchange(s, ex({}));
    expect(isStuck(s, 'associated_primes')).toBe(false);
    s = applyExchange(s, ex({}));
    expect(isStuck(s, 'associated_primes')).toBe(true);
    expect(stuckConcepts(s)).toEqual(['associated_primes']);
  });

  it('renders the strategy-change instruction for the prompt', () => {
    let s = emptyLearner();
    s = applyExchange(s, ex({}));
    s = applyExchange(s, ex({}));
    expect(stuckNoteForPrompt(s, 'associated_primes')).toBeNull();
    s = applyExchange(s, ex({}));
    const note = stuckNoteForPrompt(s, 'associated_primes');
    expect(note).toContain('3 times');
    expect(note).toContain('Do NOT repeat');
    expect(note).toContain('explain the idea back');
  });
});

// --- Meta tags ----------------------------------------------------------------

describe('CONCEPT / QKIND meta tags', () => {
  it('slugifyConcept produces stable learner keys', () => {
    expect(slugifyConcept('Associated Primes!')).toBe('associated_primes');
    expect(slugifyConcept('  direct  limits ')).toBe('direct_limits');
  });

  it('parses concept and qkind tags', () => {
    const parsed = parseAnnotations(
      'Because it vacuously holds. [CONCEPT:associated primes]\n[QKIND:why]',
    );
    expect(parsed).toContainEqual({ kind: 'concept', name: 'associated_primes' });
    expect(parsed).toContainEqual({ kind: 'qkind', qkind: 'why' });
  });

  it('meta tags never reach the speech path', () => {
    const stripped = stripAnnotationTags('Answer here. [CONCEPT:limits][QKIND:define]');
    expect(stripped).not.toMatch(/\[|\]|CONCEPT|QKIND/);
  });

  it('normalizeQKind falls back to other', () => {
    expect(normalizeQKind('how-connects')).toBe('how-connects');
    expect(normalizeQKind('banana')).toBe('other');
    expect(normalizeQKind(undefined)).toBe('other');
  });
});

// --- Context pack + prompt surfaces -------------------------------------------

const manifest = {
  format: 'hpub/0.1',
  title: 't',
  view_layer: 'book.pdf',
  text_layer: 'content.md',
  page_count: 2,
  alignment: [
    { page: 1, md_char_start: 0, md_char_end: 11, confidence: 1, method: 'anchored' },
    { page: 2, md_char_start: 11, md_char_end: 22, confidence: 1, method: 'anchored' },
  ],
} as unknown as HpubManifest;

describe('concept history in pack and prompt', () => {
  it('pack carries concept_states, capped to 10 most-asked', () => {
    const conceptStates = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`c${i}`, { bloom: 2, asked: i, last_ts: '' }]),
    );
    const pack = buildContextPack({
      md: 'hello world foo bar baz',
      manifest,
      page: 1,
      conceptStates,
    });
    const entries = Object.entries(pack.concept_states);
    expect(entries.length).toBe(10);
    expect(entries[0]![0]).toBe('c14'); // most-asked first
  });

  it('user message renders the concept history section', () => {
    const pack = buildContextPack({
      md: 'hello world foo bar baz',
      manifest,
      page: 1,
      conceptStates: { limits: { bloom: 1, asked: 3, last_ts: '' } },
    });
    const msg = buildProfessorUserMessage('what is a limit?', pack);
    expect(msg).toContain("Reader's concept history");
    expect(msg).toContain('limits: asked 3x, Bloom level 1/6');
  });

  it('no history → no history section', () => {
    const pack = buildContextPack({ md: 'hello world foo bar baz', manifest, page: 1 });
    expect(buildProfessorUserMessage('q', pack)).not.toContain('concept history');
  });
});
