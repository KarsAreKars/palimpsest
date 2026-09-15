/**
 * mathCheck — deterministic per-step derivation checking client.
 *
 * Talks to the Palimpsest voice/math sidecar (http://127.0.0.1:8737/check).
 * The CAS decides correctness; the LLM only diagnoses. Three-valued verdicts:
 * a step is never called wrong without a counterexample, and "unknown" means
 * the professor must look — never a failure.
 *
 * Contract with the Python sidecar (qwen_server.py): see POST /check there.
 * This file was seeded by the orchestrator; the professor lane implements the
 * real HTTP client, keeping these exported types and signatures byte-identical.
 */

export interface CheckStepInput {
  /** Stable step id from the workbench store. */
  id: string;
  /** LaTeX source of the step (what the user/professor wrote). */
  latex: string;
}

/** Wire shape of the counterexample, exactly as qwen_server.py emits it
 *  (snake_case is canonical on the wire; camelCase is accepted as a legacy
 *  alias so a respelling never silently empties the chips again). */
export interface CheckCounterexample {
  assignments: Record<string, number | string>;
  prevValue: string;
  stepValue: string;
}

export interface CheckStepVerdict {
  id: string;
  status: 'ok' | 'parse_error';
  verdict?:
    | 'equivalent'
    | 'equivalent_same_roots'
    | 'implied_forward'
    | 'implied_backward'
    | 'not_equivalent'
    | 'unknown';
  basis?: 'proven' | 'numeric_evidence' | 'none';
  counterexample?: CheckCounterexample;
  failingSubexpressionLatex?: string;
  elapsedMs?: number;
}

export interface CheckDerivationResult {
  steps: CheckStepVerdict[];
  goal?: { reached: boolean; byStep?: string };
  engine?: { name: string; version?: string };
  /** True when the sidecar is unreachable or the math engine is unavailable.
   *  Callers must degrade gracefully (echo mode): no marks, no blame. */
  unavailable?: boolean;
}

const SIDECAR_URL = 'http://127.0.0.1:8737';
const DEFAULT_TIMEOUT_MS = 10_000;
/** /health must be cheap — a dead sidecar must fail fast, not eat the budget. */
const HEALTH_TIMEOUT_MS = 2_000;

const VERDICTS = new Set([
  'equivalent',
  'equivalent_same_roots',
  'implied_forward',
  'implied_backward',
  'not_equivalent',
  'unknown',
]) as ReadonlySet<string>;
const BASES = new Set(['proven', 'numeric_evidence', 'none']) as ReadonlySet<string>;

const UNAVAILABLE: CheckDerivationResult = { unavailable: true, steps: [] };

interface RawCheckResponse {
  steps?: unknown;
  goal?: unknown;
  engine?: unknown;
  error?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Coerce one raw step verdict; unknown strings degrade, never throw. */
function mapStep(raw: unknown): CheckStepVerdict {
  const r = isObject(raw) ? raw : {};
  const id = typeof r['id'] === 'string' ? r['id'] : '';
  const status: CheckStepVerdict['status'] = r['status'] === 'parse_error' ? 'parse_error' : 'ok';
  const rawVerdict = r['verdict'];
  const verdict =
    typeof rawVerdict === 'string' && VERDICTS.has(rawVerdict)
      ? (rawVerdict as CheckStepVerdict['verdict'])
      : undefined;
  const rawBasis = r['basis'];
  const basis =
    typeof rawBasis === 'string' && BASES.has(rawBasis)
      ? (rawBasis as CheckStepVerdict['basis'])
      : undefined;
  const cx = isObject(r['counterexample']) ? r['counterexample'] : undefined;
  // The sidecar (qwen_server.py POST /check) emits snake_case ONLY:
  // counterexample {assignments, prev_value, step_value} and elapsed_ms.
  // camelCase is read as an alias so both spellings map; snake_case wins.
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const elapsed = r['elapsed_ms'] ?? r['elapsedMs'];
  return {
    id,
    status,
    verdict,
    basis,
    ...(cx
      ? {
          counterexample: {
            assignments: (isObject(cx['assignments']) ? cx['assignments'] : {}) as Record<
              string,
              number | string
            >,
            prevValue: str(cx['prev_value']) ?? str(cx['prevValue']) ?? '',
            stepValue: str(cx['step_value']) ?? str(cx['stepValue']) ?? '',
          },
        }
      : {}),
    ...(typeof r['failingSubexpressionLatex'] === 'string'
      ? { failingSubexpressionLatex: r['failingSubexpressionLatex'] as string }
      : {}),
    ...(typeof elapsed === 'number' ? { elapsedMs: elapsed as number } : {}),
  };
}

function mapResponse(json: RawCheckResponse): CheckDerivationResult {
  if (typeof json['error'] === 'string') return UNAVAILABLE;
  const result: CheckDerivationResult = {
    steps: Array.isArray(json['steps']) ? json['steps'].map(mapStep) : [],
  };
  const rawGoal = json['goal'];
  if (isObject(rawGoal)) {
    const byStep = rawGoal['by_step'] ?? rawGoal['byStep'];
    result.goal = {
      reached: rawGoal['reached'] === true,
      ...(typeof byStep === 'string' ? { byStep } : {}),
    };
  }
  const rawEngine = json['engine'];
  if (isObject(rawEngine) && typeof rawEngine['name'] === 'string') {
    result.engine = {
      name: rawEngine['name'] as string,
      ...(typeof rawEngine['version'] === 'string'
        ? { version: rawEngine['version'] as string }
        : {}),
    };
  }
  return result;
}

async function fetchJson(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check an ordered derivation. Adjacent steps are compared pairwise
 * (step k vs step k-1) plus optionally against a goal expression.
 * Never throws on sidecar failure — returns `{ unavailable: true }`.
 */
export async function checkDerivation(
  steps: CheckStepInput[],
  goalLatex?: string,
  opts?: { timeoutMs?: number },
): Promise<CheckDerivationResult> {
  // Health-guard first: a cheap probe decides echo mode before we spend a
  // POST. Unreachable or non-2xx → echo, silently. Never blame the student.
  try {
    const health = await fetchJson(`${SIDECAR_URL}/health`, HEALTH_TIMEOUT_MS);
    if (!health.ok) return UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SIDECAR_URL}/check`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        steps: steps.map((s) => ({ id: s.id, latex: s.latex })),
        ...(goalLatex ? { goal_latex: goalLatex } : {}),
      }),
    });
    if (!res.ok) return UNAVAILABLE; // 503 {"error":"math engine unavailable"} lands here
    const json = (await res.json()) as RawCheckResponse;
    return mapResponse(json);
  } catch {
    return UNAVAILABLE; // timeout, abort, malformed JSON — echo, never throw
  } finally {
    clearTimeout(timer);
  }
}
