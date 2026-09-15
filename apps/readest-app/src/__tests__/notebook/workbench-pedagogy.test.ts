/**
 * Workbench 2.x pedagogy lane contract tests (S1): probe chips, the concept
 * map, teach-back, the probe signal, and the space-joined protocol bodies.
 * Style follows workbench-chat.test.ts (vitest, describe/test, @/ imports).
 */
import { describe, expect, test } from 'vitest';
import { parseProfessorTags } from '@/services/professor/professorTags';
import { PROFESSOR_WORKBENCH_ADDENDUM } from '@/services/professor/prompt';
import {
  commitProfessorBlock,
  isProbeSignal,
  latestConceptMap,
  newBlockId,
  parseTranscript,
  resolveConceptThreads,
  serializeTranscript,
  stripPartialTagTail,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';

describe('professor pedagogy tags (S1)', () => {
  test('parses [PROBE] and strips it from display', () => {
    const parsed = parseProfessorTags('Before we begin, choose your stance.\n[PROBE]');
    expect(parsed.probe).toBe(true);
    expect(parsed.display).toBe('Before we begin, choose your stance.');
    expect(parsed.display).not.toContain('[');
  });

  test('parses [CONCEPTS known:a, b; edge:c; unknown:d] into three shelves', () => {
    const raw =
      'Body.\n[CONCEPTS known:Fourier series, orthogonality; edge:convergence; unknown:Parseval]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.conceptMap).toEqual({
      known: ['Fourier series', 'orthogonality'],
      edge: ['convergence'],
      unknown: ['Parseval'],
    });
    expect(parsed.display).toBe('Body.');
    expect(parsed.display).not.toContain('[');
  });

  test('captures [CONCEPTS] and [TEACHBACK] even inside an unterminated $$ shield, and leaves [0,1] math intact', () => {
    const raw = '$$x^2+1\n[CONCEPTS known:a; edge:b; unknown:c]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.conceptMap).toEqual({ known: ['a'], edge: ['b'], unknown: ['c'] });
    expect(parsed.display).not.toContain('CONCEPTS');

    const raw2 = '$$x \\in [0,1]$$\n[TEACHBACK ask:state the step]';
    const parsed2 = parseProfessorTags(raw2);
    expect(parsed2.teachbackAsk).toBe('state the step');
    expect(parsed2.display).toContain('[0,1]');
    expect(parsed2.display).not.toContain('TEACHBACK');
  });

  test('lowercase [concepts:…] and malformed brackets pass through untouched', () => {
    const raw = 'See [concepts:lowercase] untouched.';
    const parsed = parseProfessorTags(raw);
    expect(parsed.display).toBe(raw);
    expect(parsed.conceptMap).toBeUndefined();
    expect(parsed.probe).toBeUndefined();
  });
});

describe('stripPartialTagTail — space-joined protocol bodies', () => {
  // The strip eats the tag and the spaces/tabs before it; the newline that
  // separated the tag from the prose stays (pinned by the 2.1 suite's
  // 'Some prose\n\n' cases — rendering trims it anyway).
  test('hides a partial [CONCEPTS known:Fourier tail mid-stream', () => {
    expect(stripPartialTagTail('…words\n[CONCEPTS known:Fourier')).toBe('…words\n');
  });

  test('hides a partial [TEACHBACK ask:Why does tail', () => {
    expect(stripPartialTagTail('…words\n[TEACHBACK ask:Why does')).toBe('…words\n');
  });

  test('a complete tag at end-of-string is still held back', () => {
    expect(stripPartialTagTail('Body.\n[PROBE]')).toBe('Body.\n');
    expect(stripPartialTagTail('Body.\n[EVALUATION]')).toBe('Body.\n');
  });
});

describe('commitProfessorBlock — pedagogy fields', () => {
  test('carries probe, conceptMap with resolved thread ids, and teachbackAsk', () => {
    const earlier: TranscriptBlock = {
      id: 'blk_a',
      author: 'professor',
      content: 'The Fourier transform splits a signal.',
      at: '2026-09-15T10:00:00Z',
      concept: 'Fourier transform',
    };
    const raw =
      'Where shall we start?\n[PROBE]\n[CONCEPTS known:Fourier transform; edge:; unknown:Parseval]\n[TEACHBACK ask:state the load-bearing step]';
    const block = commitProfessorBlock(raw, [earlier]);
    expect(block.probe).toBe(true);
    expect(block.teachbackAsk).toBe('state the load-bearing step');
    expect(block.conceptMap).toEqual({
      known: [{ name: 'Fourier transform', threadId: 'blk_a' }],
      edge: [],
      unknown: [{ name: 'Parseval', threadId: null }],
    });
    expect(block.content).not.toContain('[');
  });

  test('links an [EVALUATION] block to the latest teach-back attempt block', () => {
    const u1: TranscriptBlock = {
      id: 'u1',
      author: 'user',
      content: 'My attempt one.',
      at: '2026-09-15T10:00:00Z',
      teachbackAsk: 'first ask',
    };
    const prof: TranscriptBlock = {
      id: 'p1',
      author: 'professor',
      content: 'Notes on attempt one.',
      at: '2026-09-15T10:01:00Z',
    };
    const u2: TranscriptBlock = {
      id: 'u2',
      author: 'user',
      content: 'My attempt two.',
      at: '2026-09-15T10:02:00Z',
      teachbackAsk: 'second ask',
    };
    const block = commitProfessorBlock(
      'You said the transform preserves energy — exactly.\n[EVALUATION]',
      [u1, prof, u2],
    );
    expect(block.teachbackOf).toBe('u2');
  });
});

describe('probe signal', () => {
  test('isProbeSignal matches "I don\'t know" anywhere and never plain prose like "knowledge"', () => {
    expect(isProbeSignal("I don't know where the factor goes")).toBe(true);
    expect(isProbeSignal('I DO NOT KNOW this yet')).toBe(true);
    expect(isProbeSignal('honestly, no idea')).toBe(true);
    expect(isProbeSignal('I have no idea what Parseval means')).toBe(true);
    expect(isProbeSignal('knowledge of the boundary terms matters')).toBe(false);
    expect(isProbeSignal('I know this one')).toBe(false);
  });
});

describe('concept map helpers', () => {
  test('latestConceptMap returns the newest shelves; resolveConceptThreads maps names to latest [CONCEPT] blocks and null for new names', () => {
    const blkA: TranscriptBlock = {
      id: 'blk_a',
      author: 'professor',
      content: 'About the Fourier transform.',
      at: '2026-09-15T10:00:00Z',
      concept: 'fourier transform',
    };
    const userBetween: TranscriptBlock = {
      id: 'blk_u',
      author: 'user',
      content: 'Between blocks.',
      at: '2026-09-15T10:01:00Z',
    };
    const blkB: TranscriptBlock = {
      id: 'blk_b',
      author: 'professor',
      content: 'The map so far.',
      at: '2026-09-15T10:02:00Z',
      conceptMap: {
        known: [{ name: 'fourier transform', threadId: 'blk_a' }],
        edge: [],
        unknown: [{ name: 'wavelets', threadId: null }],
      },
    };
    const latest = latestConceptMap([blkA, userBetween, blkB]);
    expect(latest).toEqual(blkB.conceptMap);
    expect(latestConceptMap([blkA])).toBeNull();

    const resolved = resolveConceptThreads([blkA, userBetween], {
      known: ['fourier transform'],
      edge: ['entropy'],
      unknown: [],
    });
    expect(resolved.known[0]).toEqual({ name: 'fourier transform', threadId: 'blk_a' });
    expect(resolved.edge[0]).toEqual({ name: 'entropy', threadId: null });
  });
});

describe('transcript round-trip (S1 fields)', () => {
  test('serialize→parse preserves probe/conceptMap/teachback fields, and a 2.1-shape block without them still parses', () => {
    const block: TranscriptBlock = {
      id: newBlockId(),
      author: 'professor',
      content: 'Where shall we start?',
      at: '2026-09-15T10:00:00Z',
      probe: true,
      probePicked: 'ask',
      conceptMap: {
        known: [{ name: 'fourier transform', threadId: 'blk_x' }],
        edge: [],
        unknown: [{ name: 'wavelets', threadId: null }],
      },
      teachbackAsk: 'state the step',
      teachbackOf: 'u9',
    };
    expect(parseTranscript(serializeTranscript([block]))).toEqual([block]);

    // A literal 2.1 transcript string (four fields only, version 1).
    const legacy =
      '{"version":1,"savedAt":"2026-09-15T10:00:00Z","blocks":[{"id":"b1","author":"professor","content":"Welcome.","at":"2026-09-15T10:00:00Z","kind":"greeting"}]}';
    const parsed = parseTranscript(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(1);
    expect(parsed![0]!.content).toBe('Welcome.');
    expect(parsed![0]!.probe).toBeUndefined();
  });
});

describe('workbench addendum — pedagogy lines pinned', () => {
  test('probe-first, the three stance phrases, never-grade "I don\'t know", and the three new tag literals are present', () => {
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[PROBE]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain(
      '[CONCEPTS known:name, name; edge:name; unknown:name]',
    );
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[TEACHBACK ask:the restatement you want]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('[EVALUATION]');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('lead me');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('ask me first');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toContain('I will work it');
    expect(PROFESSOR_WORKBENCH_ADDENDUM).toMatch(/never grade it/i);
  });
});
