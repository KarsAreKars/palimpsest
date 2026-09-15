/**
 * workbenchChat — contract tests for the block-transcript state module:
 * math extraction for the silent checker, the professor's checker summary,
 * professor-block commit (protocol tags never reach display), partial-tag
 * buffering, and the file round-trip.
 */
import { describe, expect, test } from 'vitest';
import {
  commitProfessorBlock,
  extractMathSteps,
  newBlockId,
  parseTranscript,
  serializeTranscript,
  stripPartialTagTail,
  summarizeChecks,
  type BlockCheck,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';

describe('extractMathSteps', () => {
  test('plain prose yields no steps — those blocks never wear a chip', () => {
    expect(extractMathSteps('I think it is about entropy.', 'b1')).toEqual([]);
  });

  test('display math wins, one step per $$ segment', () => {
    const steps = extractMathSteps(
      'So the coefficients are\n$$b_n = \\frac{1}{\\pi}\\int f$$\nand then\n$$b_n \\to 0$$',
      'b1',
    );
    expect(steps).toEqual([
      { id: 'b1:0', latex: 'b_n = \\frac{1}{\\pi}\\int f' },
      { id: 'b1:1', latex: 'b_n \\to 0' },
    ]);
  });

  test('inline math is the fallback when no $$ is present', () => {
    const steps = extractMathSteps('so $x + 1 = 2$ follows from $x = 1$', 'b2');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({ id: 'b2:0', latex: 'x + 1 = 2' });
  });

  test('bare math-y prose is the last resort', () => {
    const steps = extractMathSteps('x + 1 = 2', 'b3');
    expect(steps).toEqual([{ id: 'b3:0', latex: 'x + 1 = 2' }]);
  });

  test('mixed prose + display math only checks the math', () => {
    const steps = extractMathSteps('therefore $$\\int_0^1 x dx = \\frac12$$ as we said', 'b4');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.latex).toBe('\\int_0^1 x dx = \\frac12');
  });
});

describe('extractMathSteps — prose guards', () => {
  test('an unterminated $$ shields prose, not a step (no manufactured parse_error chip)', () => {
    expect(extractMathSteps('therefore $$x^2 + 1', 'b9')).toEqual([]);
    expect(extractMathSteps('$$x^2 + 1', 'b9')).toEqual([]);
  });

  test('a complete pair still wins even when a later $$ is unterminated', () => {
    const steps = extractMathSteps('$$a=b$$ and then prose $$open', 'b9');
    expect(steps).toEqual([{ id: 'b9:0', latex: 'a=b' }]);
  });

  test('sentence-like prose with one math symbol is prose, not a step', () => {
    expect(extractMathSteps('so e = mc² means energy and mass are the same coin', 'b10')).toEqual(
      [],
    );
  });

  test('short mathy fragments still qualify as the last resort', () => {
    expect(extractMathSteps('let x = 5', 'b11')).toEqual([{ id: 'b11:0', latex: 'let x = 5' }]);
    expect(extractMathSteps('x + 1 = 2', 'b11')).toEqual([{ id: 'b11:0', latex: 'x + 1 = 2' }]);
  });
});

describe('summarizeChecks', () => {
  test('null when there is nothing to say', () => {
    expect(summarizeChecks([])).toBeNull();
    expect(summarizeChecks([{ status: 'checking' }])).toBeNull();
    expect(summarizeChecks([{ status: 'unavailable' }])).toBeNull();
  });

  test('completed verdicts form the professor-facing summary line', () => {
    const checks: BlockCheck[] = [
      {
        status: 'done',
        verdicts: [
          { id: 'b1:0', status: 'ok', verdict: 'equivalent' },
          {
            id: 'b1:1',
            status: 'ok',
            verdict: 'not_equivalent',
            counterexample: {
              assignments: { n: 2 },
              prevValue: '4',
              stepValue: '6',
            },
          },
        ],
      },
    ];
    expect(summarizeChecks(checks)).toBe(
      'checker: step 1 equivalent; step 2 not_equivalent, counterexample n=2 gives 4 vs 6',
    );
  });

  test('steps are numbered with a GLOBAL ordinal across blocks (no two step 1s)', () => {
    const checks: BlockCheck[] = [
      { status: 'done', verdicts: [{ id: 'b1:0', status: 'ok', verdict: 'equivalent' }] },
      {
        status: 'done',
        verdicts: [
          { id: 'b2:0', status: 'ok', verdict: 'equivalent' },
          { id: 'b2:1', status: 'ok', verdict: 'not_equivalent' },
        ],
      },
      { status: 'done', verdicts: [{ id: 'b3:0', status: 'parse_error' }] },
    ];
    expect(summarizeChecks(checks)).toBe(
      'checker: step 1 equivalent; step 2 equivalent; step 3 not_equivalent; step 4 parse_error',
    );
  });

  test('parse errors are named honestly, not as wrong math', () => {
    const checks: BlockCheck[] = [
      { status: 'done', verdicts: [{ id: 'b1:0', status: 'parse_error' }] },
    ];
    expect(summarizeChecks(checks)).toBe('checker: step 1 parse_error');
  });
});

describe('commitProfessorBlock', () => {
  test('protocol tags are consumed into metadata, stripped from display', () => {
    const raw =
      'Entropy is the load-bearing idea here.\n\n[CONCEPT:entropy]\n[QKIND:why]\n[POINT:watch the boundary terms]\n[WORKBENCH:END]';
    const block = commitProfessorBlock(raw, []);
    expect(block.content).toBe('Entropy is the load-bearing idea here.');
    expect(block.concept).toBe('entropy');
    expect(block.qkind).toBe('why');
    expect(block.point).toBe('watch the boundary terms');
    expect(block.ended).toBe(true);
    expect(block.kind).toBe('greeting');
  });

  test('a block matrix literal [A] inside $$ math survives', () => {
    const raw = '$$\nA = [B]\n$$\n\n[CONCEPT:matrices]';
    const block = commitProfessorBlock(raw, []);
    expect(block.content).toContain('[B]');
    expect(block.content).not.toContain('[CONCEPT');
  });

  test('later professor blocks are not greetings', () => {
    const first = commitProfessorBlock('Welcome.', []);
    const second = commitProfessorBlock('Now — your turn.', [first]);
    expect(second.kind).toBeUndefined();
  });
});

describe('stripPartialTagTail', () => {
  test('a tag cut off mid-stream never reaches the eye', () => {
    expect(stripPartialTagTail('Some prose\n\n[CONCEPT:ent')).toBe('Some prose\n\n');
    expect(stripPartialTagTail('Some prose [QKIND')).toBe('Some prose');
  });

  test('a COMPLETE tag at end-of-string is held back too (the protocol line is only safe at commit)', () => {
    expect(stripPartialTagTail('Some prose\n\n[QKIND:why]')).toBe('Some prose\n\n');
    expect(stripPartialTagTail('Watch the boundary. [CONCEPT:entropy]')).toBe(
      'Watch the boundary.',
    );
    expect(stripPartialTagTail('[WORKBENCH:END]')).toBe('');
  });

  test('a trailing lone [ never leaks (first stroke of a tag or an interval)', () => {
    expect(stripPartialTagTail('the interval is [')).toBe('the interval is');
    expect(stripPartialTagTail('prose [')).toBe('prose');
  });

  test('closed tags and bracket-free tails pass through', () => {
    expect(stripPartialTagTail('Some [CONCEPT:x] prose')).toBe('Some [CONCEPT:x] prose');
    expect(stripPartialTagTail('Some prose')).toBe('Some prose');
    expect(stripPartialTagTail('the pair [A, B] matters')).toBe('the pair [A, B] matters');
    expect(stripPartialTagTail('an interval [0,1] inline')).toBe('an interval [0,1] inline');
  });
});

describe('transcript file round-trip', () => {
  test('serialize → parse preserves blocks', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: newBlockId(),
        author: 'professor',
        content: 'Welcome back.',
        at: '2026-09-15T10:00:00Z',
        kind: 'greeting',
        concept: 'entropy',
      },
      {
        id: newBlockId(),
        author: 'user',
        content: 'into the surroundings?',
        at: '2026-09-15T10:01:00Z',
      },
    ];
    expect(parseTranscript(serializeTranscript(blocks))).toEqual(blocks);
  });

  test('malformed shapes return null, never throw', () => {
    expect(parseTranscript('not json')).toBeNull();
    expect(parseTranscript('{"version":1}')).toBeNull();
    expect(parseTranscript('{"version":1,"blocks":[{"id":1}]}')).toBeNull();
    expect(parseTranscript('[]')).toBeNull();
  });

  test('adversarial round-trip: unterminated $$, stray [, emoji, empty and 50k blocks', () => {
    const adversarial: TranscriptBlock[] = [
      {
        id: newBlockId(),
        author: 'professor',
        content: '$$x^2 + 1\n[CONCEPT:leak] shields nothing here',
        at: '2026-09-15T10:00:00Z',
      },
      {
        id: newBlockId(),
        author: 'user',
        content: 'a stray [ and an interval [0,1]',
        at: '2026-09-15T10:01:00Z',
      },
      {
        id: newBlockId(),
        author: 'user',
        content: 'emoji ✳✨📚 and ünïcödé',
        at: '2026-09-15T10:02:00Z',
      },
      { id: newBlockId(), author: 'user', content: '', at: '2026-09-15T10:03:00Z' },
      {
        id: newBlockId(),
        author: 'professor',
        content: 'x'.repeat(50_000),
        at: '2026-09-15T10:04:00Z',
      },
    ];
    expect(parseTranscript(serializeTranscript(adversarial))).toEqual(adversarial);
  });
});
