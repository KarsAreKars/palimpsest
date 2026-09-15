/**
 * Workbench 2.x structured-derivation lane contract tests (S3): the
 * DERIVE/STEP tag grammar, the folio build in commitProfessorBlock, the
 * desk-side global ordinal, the whole-unit CAS mapping (fetch stubbed, the
 * mathcheck.test.ts idiom), and the echo mode. Includes the audit R3 tail
 * case for a half-streamed step mark (its one home, per the test inventory).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkDerivation } from '@/services/professor/mathCheck';
import { parseProfessorTags } from '@/services/professor/professorTags';
import {
  MAX_STEPS_PER_CHECK,
  associateLearnerStep,
  commitProfessorBlock,
  derivationOrdinal,
  newBlockId,
  stripPartialTagTail,
  summarizeChecks,
  type BlockCheck,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const HEALTHY = { ok: true, model: 'dummy', voices: [] };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FOLIO_RAW =
  '[DERIVE title:The quadratic formula goal:x = 2]\n' +
  '$$x + 3 = 5$$\n' +
  'both sides keep their balance when the same number leaves each\n' +
  '[STEP 1 /CHECKED ok]\n' +
  '$$x = 2$$\n' +
  'the goal, restated plain\n' +
  '[STEP 2 /CHECKED bad]';

describe('derivation tag parse (S3)', () => {
  it('captures derive title/goal, step marks, and strips every tag while keeping math and justifications', () => {
    const parsed = parseProfessorTags(FOLIO_RAW);
    expect(parsed.derive).toEqual({ title: 'The quadratic formula', goal: 'x = 2' });
    expect(parsed.stepMarks).toHaveLength(2);
    expect(parsed.stepMarks![0]).toEqual({ professorChecked: 'ok' });
    expect(parsed.stepMarks![1]).toEqual({ professorChecked: 'bad' });
    expect(parsed.display).toContain('$$x + 3 = 5$$');
    expect(parsed.display).toContain(
      'both sides keep their balance when the same number leaves each',
    );
    expect(parsed.display).not.toContain('[DERIVE');
    expect(parsed.display).not.toContain('[STEP');
    expect(parsed.display).not.toContain(']');
  });

  it('captures DERIVE/STEP/DIAGRAM even inside an unterminated $$ shield; a bare [STEP] is legal', () => {
    const raw =
      '$$x^2 + 1\n[DERIVE title:Open folio]\n$$x = 1$$\nwhy\n[STEP]\n[DIAGRAM claim:a figure]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.derive).toEqual({ title: 'Open folio' });
    expect(parsed.stepMarks).toHaveLength(1);
    expect(parsed.stepMarks![0]).toEqual({}); // no /CHECKED → nothing captured
    expect(parsed.diagram).toEqual({ claim: 'a figure' });
    expect(parsed.display).not.toContain('[DERIVE');
    expect(parsed.display).not.toContain('[STEP]');
    expect(parsed.display).not.toContain('[DIAGRAM');
  });

  it('[STEP 9 /CHECKED ok] on the first step still captures (the desk renumbers)', () => {
    const parsed = parseProfessorTags('$$a = b$$\nwhy\n[STEP 9 /CHECKED ok]');
    expect(parsed.stepMarks).toEqual([{ professorChecked: 'ok' }]);
  });
});

describe('commitProfessorBlock — the folio', () => {
  it('builds steps with ids, justifications, professorChecked, and the goal', () => {
    const block = commitProfessorBlock(FOLIO_RAW, []);
    expect(block.derivation).toBeDefined();
    const d = block.derivation!;
    expect(d.title).toBe('The quadratic formula');
    expect(d.goalLatex).toBe('x = 2');
    expect(d.steps).toHaveLength(2);
    expect(d.steps[0]).toEqual({
      id: `${block.id}:0`,
      latex: 'x + 3 = 5',
      justification: 'both sides keep their balance when the same number leaves each',
      professorChecked: 'ok',
    });
    expect(d.steps[1]).toEqual({
      id: `${block.id}:1`,
      latex: 'x = 2',
      justification: 'the goal, restated plain',
      professorChecked: 'bad',
    });
  });

  it('[STEP] with no /CHECKED yields professorChecked: undefined', () => {
    const block = commitProfessorBlock('[DERIVE]\n$$a = b$$\nsome reason\n[STEP]', []);
    expect(block.derivation!.steps[0]).toEqual({
      id: `${block.id}:0`,
      latex: 'a = b',
      justification: 'some reason',
    });
  });

  it('a derive tag with zero $$ segments yields an empty folio (the title still shows as prose)', () => {
    const block = commitProfessorBlock('[DERIVE title:Why the series diverges]\nIt diverges.', []);
    expect(block.derivation).toEqual({ title: 'Why the series diverges', steps: [] });
  });
});

describe('derivationOrdinal — one ledger across the transcript', () => {
  it('numbers steps globally: folio A (2 steps), prose, folio B (1 step) → 1,2,3', () => {
    const folioA: TranscriptBlock = {
      id: 'a',
      author: 'professor',
      content: '',
      at: '2026-09-15T10:00:00Z',
      derivation: {
        steps: [
          { id: 'a:0', latex: 'x+3=5' },
          { id: 'a:1', latex: 'x=2' },
        ],
      },
    };
    const prose: TranscriptBlock = {
      id: 'p',
      author: 'professor',
      content: 'A prose interlude.',
      at: '2026-09-15T10:01:00Z',
    };
    const folioB: TranscriptBlock = {
      id: 'b',
      author: 'professor',
      content: '',
      at: '2026-09-15T10:02:00Z',
      derivation: { steps: [{ id: 'b:0', latex: 'y=4' }] },
    };
    const blocks = [folioA, prose, folioB];
    expect(derivationOrdinal(blocks, 'a', 0)).toBe(1);
    expect(derivationOrdinal(blocks, 'a', 1)).toBe(2);
    expect(derivationOrdinal(blocks, 'b', 0)).toBe(3);
  });
});

describe('associateLearnerStep (s3 §7.3)', () => {
  it('appends step/justify-only blocks to the open folio; prose blocks return the array unchanged', () => {
    const folio = commitProfessorBlock(
      '[DERIVE title:Folio goal:x = 2]\n$$x+3=5$$\nremove 3 from both sides\n[STEP]',
      [],
    );
    const stepAppend: TranscriptBlock = {
      id: 'u1',
      author: 'user',
      content: '$$x=2$$\nso x is 2',
      at: '2026-09-15T10:03:00Z',
    };
    const before = [folio];
    const next = associateLearnerStep(before, stepAppend);
    expect(next).not.toBe(before);
    expect(next[0]!.derivation!.steps).toHaveLength(2);
    expect(next[0]!.derivation!.steps[1]).toEqual({
      id: `${folio.id}:1`,
      latex: 'x=2',
      justification: 'so x is 2',
    });

    const proseBlock: TranscriptBlock = {
      id: 'u2',
      author: 'user',
      content: 'Wait, why may I subtract?',
      at: '2026-09-15T10:04:00Z',
    };
    const unchanged = associateLearnerStep(next, proseBlock);
    expect(unchanged).toBe(next); // same reference — no state move happened

    const leadingProse: TranscriptBlock = {
      id: 'u3',
      author: 'user',
      content: 'I think\n$$x=2$$\nso x is 2',
      at: '2026-09-15T10:05:00Z',
    };
    expect(associateLearnerStep(next, leadingProse)).toBe(next);
  });
});

describe('whole-unit CAS mapping (fetch stubbed, the mathcheck idiom)', () => {
  it('posts one /check with {steps, goal_latex} and maps goal snake_case → camelCase', async () => {
    const block = commitProfessorBlock(FOLIO_RAW, []);
    const steps = block.derivation!.steps.map(({ id, latex }) => ({ id, latex }));
    expect(steps).toEqual([
      { id: `${block.id}:0`, latex: 'x + 3 = 5' },
      { id: `${block.id}:1`, latex: 'x = 2' },
    ]);

    fetchMock.mockResolvedValueOnce(jsonResponse(HEALTHY)).mockResolvedValueOnce(
      jsonResponse({
        steps: [
          { id: steps[0]!.id, status: 'ok', verdict: 'equivalent', basis: 'proven', elapsed_ms: 4 },
          {
            id: steps[1]!.id,
            status: 'ok',
            verdict: 'not_equivalent',
            basis: 'numeric_evidence',
            counterexample: { assignments: { x: 0 }, prev_value: '3', step_value: '2' },
          },
        ],
        goal: { reached: true, by_step: steps[1]!.id },
      }),
    );
    const result = await checkDerivation(steps, block.derivation!.goalLatex);
    expect(result.unavailable).toBeUndefined();
    expect(result.goal).toEqual({ reached: true, byStep: steps[1]!.id });
    // Per-step verdicts land on the right steps, in submission order.
    expect(result.steps[1]!.counterexample).toEqual({
      assignments: { x: 0 },
      prevValue: '3',
      stepValue: '2',
    });

    const [, init] = fetchMock.mock.calls[1]!;
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/check');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      steps: [
        { id: `${block.id}:0`, latex: 'x + 3 = 5' },
        { id: `${block.id}:1`, latex: 'x = 2' },
      ],
      goal_latex: 'x = 2',
    });

    // The BlockCheck mapping the desk stores (submission order + goal).
    const check: BlockCheck = {
      status: 'done',
      verdicts: steps.map((_, i) => result.steps[i] ?? { id: `${block.id}:${i}`, status: 'ok' }),
      ...(result.goal ? { goal: result.goal } : {}),
    };
    expect(check.status).toBe('done');
    expect(check.status === 'done' && check.verdicts[0]!.verdict).toBe('equivalent');
    expect(check.status === 'done' && check.verdicts[1]!.verdict).toBe('not_equivalent');
    expect(check.status === 'done' && check.goal).toEqual({
      reached: true,
      byStep: steps[1]!.id,
    });
  });

  it('echo mode: a dead sidecar yields unavailable with no verdicts — no crash, quiet retry next turn', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Connection refused'));
    const block = commitProfessorBlock(FOLIO_RAW, []);
    const steps = block.derivation!.steps.map(({ id, latex }) => ({ id, latex }));
    const result = await checkDerivation(steps, block.derivation!.goalLatex);
    expect(result).toEqual({ unavailable: true, steps: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1); // health probe only, no POST
  });
});

describe('summarizeChecks — goal line is additive', () => {
  it('appends the goal note when a done check carries one', () => {
    const checks: BlockCheck[] = [
      {
        status: 'done',
        verdicts: [{ id: 'b1:0', status: 'ok', verdict: 'equivalent' }],
        goal: { reached: true, byStep: 'b1:0' },
      },
    ];
    expect(summarizeChecks(checks)).toBe('checker: step 1 equivalent; goal reached by b1:0');
    const missed: BlockCheck[] = [
      {
        status: 'done',
        verdicts: [{ id: 'b2:0', status: 'ok', verdict: 'not_equivalent' }],
        goal: { reached: false },
      },
    ];
    expect(summarizeChecks(missed)).toBe('checker: step 1 not_equivalent; goal not reached');
  });

  it('without goals the output is byte-identical to today', () => {
    const checks: BlockCheck[] = [
      {
        status: 'done',
        verdicts: [
          { id: 'b1:0', status: 'ok', verdict: 'equivalent' },
          { id: 'b1:1', status: 'parse_error' },
        ],
      },
    ];
    expect(summarizeChecks(checks)).toBe('checker: step 1 equivalent; step 2 parse_error');
  });
});

describe('stripPartialTagTail — the step mark (audit R3)', () => {
  // The strip eats the tag and the spaces/tabs before it; the separating
  // newline stays (same contract as the 2.1 tail cases — 'Some prose\n\n').
  it("'…words\\n[STEP 3 /CHEC' → '…words\\n' (a half-streamed step mark never reaches the eye)", () => {
    expect(stripPartialTagTail('…words\n[STEP 3 /CHEC')).toBe('…words\n');
    expect(stripPartialTagTail('…words\n[STEP /CHECKED o')).toBe('…words\n');
    expect(stripPartialTagTail('…words\n[STEP 3 /CHECKED ok')).toBe('…words\n');
    expect(stripPartialTagTail('…words\n[STEP')).toBe('…words\n');
    expect(stripPartialTagTail('…words\n[DERIVE title:x')).toBe('…words\n');
    expect(stripPartialTagTail('…words\n[DIAGRAM claim:a')).toBe('…words\n');
  });
});

describe('the step cap is shared (s3 §10 Q4)', () => {
  it('folios honour the same MAX_STEPS_PER_CHECK — step 9+ wears no chip', () => {
    expect(MAX_STEPS_PER_CHECK).toBe(8);
  });
});

describe('professor block ids stay unique (folio step ids are addressable)', () => {
  it('newBlockId yields distinct ids for consecutive folios', () => {
    const a = newBlockId();
    const b = newBlockId();
    expect(a).not.toBe(b);
  });
});
