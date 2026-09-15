/**
 * mathCheck client contract tests: the health guard, the echo fallback
 * (NEVER throws, NEVER blames), response mapping, and the unavailable paths.
 * fetch is stubbed at the global — no sidecar needed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkDerivation } from '@/services/professor/mathCheck';

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

const STEPS = [
  { id: 's1', latex: 'x+3=5' },
  { id: 's2', latex: 'x=2' },
];

describe('health guard (echo mode)', () => {
  it('returns {unavailable:true, steps:[]} when /health fails to connect', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Connection refused'));
    const result = await checkDerivation(STEPS);
    expect(result).toEqual({ unavailable: true, steps: [] });
    // echo mode: only the health probe was attempted, no POST /check
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/health');
  });

  it('returns unavailable when /health answers non-2xx, without POSTing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503));
    const result = await checkDerivation(STEPS);
    expect(result.unavailable).toBe(true);
    expect(result.steps).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws no matter how badly /health misbehaves', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket exploded'));
    await expect(checkDerivation(STEPS)).resolves.toEqual({ unavailable: true, steps: [] });
  });
});

describe('POST /check mapping', () => {
  it('posts steps (id+latex only) and goal_latex, maps the verdicts', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(HEALTHY)).mockResolvedValueOnce(
      jsonResponse({
        steps: [
          { id: 's1', status: 'ok', verdict: 'equivalent', basis: 'proven', elapsed_ms: 4 },
          {
            id: 's2',
            status: 'ok',
            verdict: 'not_equivalent',
            basis: 'numeric_evidence',
            counterexample: { assignments: { x: 0 }, prev_value: '3', step_value: '2' },
            failingSubexpressionLatex: 'x',
          },
        ],
        goal: { reached: true, by_step: 's2' },
        engine: { name: 'sympy', version: '1.13' },
      }),
    );
    const result = await checkDerivation(STEPS, 'x=2');
    expect(result.unavailable).toBeUndefined();
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ id: 's1', status: 'ok', verdict: 'equivalent' });
    expect(result.steps[1]).toMatchObject({
      id: 's2',
      verdict: 'not_equivalent',
      counterexample: { assignments: { x: 0 }, prevValue: '3', stepValue: '2' },
      failingSubexpressionLatex: 'x',
    });
    expect(result.goal).toEqual({ reached: true, byStep: 's2' });
    expect(result.engine).toEqual({ name: 'sympy', version: '1.13' });

    const [, init] = fetchMock.mock.calls[1]!;
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/check');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      steps: [
        { id: 's1', latex: 'x+3=5' },
        { id: 's2', latex: 'x=2' },
      ],
      goal_latex: 'x=2',
    });
  });

  it('omits goal_latex when no goal is given', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HEALTHY))
      .mockResolvedValueOnce(jsonResponse({ steps: [] }));
    await checkDerivation(STEPS);
    const body = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    expect(body).not.toHaveProperty('goal_latex');
  });

  it('unknown verdict strings pass through as undefined verdict with status ok', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HEALTHY))
      .mockResolvedValueOnce(
        jsonResponse({ steps: [{ id: 's1', status: 'ok', verdict: 'mostly_equivalent-ish' }] }),
      );
    const result = await checkDerivation(STEPS);
    expect(result.steps[0]).toMatchObject({ id: 's1', status: 'ok' });
    expect(result.steps[0]!.verdict).toBeUndefined();
  });

  it('tolerates garbage step entries without throwing', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HEALTHY))
      .mockResolvedValueOnce(jsonResponse({ steps: [null, 42, { status: 'parse_error' }] }));
    const result = await checkDerivation(STEPS);
    expect(result.steps.map((s) => s.status)).toEqual(['ok', 'ok', 'parse_error']);
  });
});

describe('wire-shape contract with qwen_server.py (POST /check)', () => {
  // These names are PINNED against src-tauri/resources/tts/qwen_server.py —
  // run_check() builds step records there. If the sidecar is ever respelled
  // (or a mock drifts back to camelCase), this test fails before a single
  // real counterexample reaches the professor with empty values again.
  const SIDECAR_STEP_KEYS = ['id', 'status', 'verdict', 'basis', 'elapsed_ms'] as const;
  const SIDECAR_COUNTEREXAMPLE_KEYS = ['assignments', 'prev_value', 'step_value'] as const;

  it('maps the exact snake_case fields the sidecar sends', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(HEALTHY)).mockResolvedValueOnce(
      jsonResponse({
        steps: [
          {
            id: 's2',
            status: 'ok',
            verdict: 'not_equivalent',
            basis: 'numeric_evidence',
            elapsed_ms: 7,
            counterexample: { assignments: { x: 2, y: -1 }, prev_value: '5', step_value: '7' },
          },
        ],
      }),
    );
    const result = await checkDerivation(STEPS);
    expect(result.steps[0]).toEqual({
      id: 's2',
      status: 'ok',
      verdict: 'not_equivalent',
      basis: 'numeric_evidence',
      elapsedMs: 7,
      counterexample: { assignments: { x: 2, y: -1 }, prevValue: '5', stepValue: '7' },
    });
  });

  it('the pinned key names literally appear in qwen_server.py (drift tripwire)', () => {
    // Read the sidecar source itself — if run_check() is ever respelled,
    // this fails before a single real counterexample reaches the professor
    // with empty chip values again.
    // vitest serves modules over its own URL scheme — resolve from the
    // package root (the vitest root) instead of import.meta.url.
    const sidecarSource = readFileSync(
      join(process.cwd(), 'src-tauri/resources/tts/qwen_server.py'),
      'utf8',
    );
    for (const key of SIDECAR_STEP_KEYS) {
      expect(sidecarSource).toContain(`"${key}"`);
    }
    for (const key of SIDECAR_COUNTEREXAMPLE_KEYS) {
      expect(sidecarSource).toContain(`"${key}"`);
    }
    // The response envelope and goal record the client also reads.
    expect(sidecarSource).toContain('"goal"');
    expect(sidecarSource).toContain('"by_step"');
    expect(sidecarSource).toContain('"engine"');
  });

  it('camelCase is still accepted as an alias (legacy respelling degrades soft)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(HEALTHY)).mockResolvedValueOnce(
      jsonResponse({
        steps: [
          {
            id: 's2',
            status: 'ok',
            verdict: 'not_equivalent',
            counterexample: { assignments: { x: 0 }, prevValue: '3', stepValue: '2' },
            elapsedMs: 9,
          },
        ],
      }),
    );
    const result = await checkDerivation(STEPS);
    expect(result.steps[0]!.counterexample).toEqual({
      assignments: { x: 0 },
      prevValue: '3',
      stepValue: '2',
    });
    expect(result.steps[0]!.elapsedMs).toBe(9);
  });

  it('snake_case wins when both spellings ride in one payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(HEALTHY)).mockResolvedValueOnce(
      jsonResponse({
        steps: [
          {
            id: 's2',
            status: 'ok',
            verdict: 'not_equivalent',
            counterexample: {
              prev_value: 'real',
              prevValue: 'legacy',
              step_value: 'wire',
              stepValue: 'alias',
            },
            elapsed_ms: 1,
            elapsedMs: 2,
          },
        ],
      }),
    );
    const result = await checkDerivation(STEPS);
    expect(result.steps[0]!.counterexample).toMatchObject({ prevValue: 'real', stepValue: 'wire' });
    expect(result.steps[0]!.elapsedMs).toBe(1);
  });
});

describe('unavailable paths on POST', () => {
  it('503 with {"error":"math engine unavailable"} → unavailable', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HEALTHY))
      .mockResolvedValueOnce(jsonResponse({ error: 'math engine unavailable' }, 503));
    const result = await checkDerivation(STEPS);
    expect(result).toEqual({ unavailable: true, steps: [] });
  });

  it('any non-2xx from /check → unavailable echo', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HEALTHY))
      .mockResolvedValueOnce(jsonResponse({ detail: 'nope' }, 500));
    const result = await checkDerivation(STEPS);
    expect(result.unavailable).toBe(true);
  });

  it('a POST that throws (timeout/abort) → unavailable, never rejects', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HEALTHY))
      .mockRejectedValueOnce(new Error('abort'));
    await expect(checkDerivation(STEPS)).resolves.toEqual({ unavailable: true, steps: [] });
  });

  it('malformed JSON body → unavailable, never throws', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(HEALTHY))
      .mockResolvedValueOnce(new Response('not json at all', { status: 200 }));
    await expect(checkDerivation(STEPS)).resolves.toEqual({ unavailable: true, steps: [] });
  });
});
