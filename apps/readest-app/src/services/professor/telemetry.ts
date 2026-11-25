/**
 * profTelemetry — one structured trace across the whole Prof loop:
 *   open → input (typewhisper/voice) → stt → ask → llm (ttft) → voice
 *   (first audio) → ink → done/error.
 * Every event logs `[prof] +<ms> <event> <json>` to the app log and lands
 * in a ring buffer dumped on error, so a bug report is "read the log",
 * never "describe what you saw".
 */

type TelemetryData = Record<string, unknown>;

import { nlog, nwarn } from '@/services/narration/log';
import type { Stance } from './stance';

const RING_SIZE = 80;
const ring: { ms: number; event: string; data?: TelemetryData }[] = [];
let t0 = 0;

export const profTraceReset = () => {
  t0 = performance.now();
  ring.length = 0;
};

export const profTrace = (event: string, data?: TelemetryData) => {
  if (!t0) t0 = performance.now();
  const ms = Math.round(performance.now() - t0);
  ring.push({ ms, event, data });
  if (ring.length > RING_SIZE) ring.shift();
  // nlog, not console.info: the desktop webview console is invisible to
  // Readest.log — only the tauri-plugin-log bridge lands there.
  nlog(`[prof] +${ms}ms ${event}${data ? ' ' + JSON.stringify(data) : ''}`);
};

/** Dump the recent trail on failure — the report reads itself. */
export const profTraceDump = (why: string, err?: unknown) => {
  nwarn(`[prof] FAILED: ${why}`, err);
  nwarn(
    '[prof] trail:\n' +
      ring.map((r) => `  +${r.ms}ms ${r.event} ${r.data ? JSON.stringify(r.data) : ''}`).join('\n'),
  );
};

// ---------------------------------------------------------------------------
// Wave 3 — the r_sol proxy (TUTORRL_DEEPDIVE §5.4: the reward SHAPE as
// telemetry, without RL). After the professor takes a stance, did the
// learner's NEXT graded attempt improve? One number per stance — read by
// the Wave 3 CI and by the offline TutorRL labeling lane (Ruling 5 #7:
// offline only, never a runtime router).
// ---------------------------------------------------------------------------

export type CheckVerdict = 'pass' | 'retry';

/** The improvement atom: the previous graded attempt failed, the next passed. */
export const nextAttemptImproved = (prev: CheckVerdict, next: CheckVerdict): boolean =>
  prev === 'retry' && next === 'pass';

const STANCE_OUTCOME_CAP = 200;
const stanceOutcomes: { stance: Stance; improved: boolean }[] = [];

/** Record the learner's next graded-attempt outcome after a stance. */
export const noteStanceOutcome = (stance: Stance, improved: boolean): void => {
  stanceOutcomes.push({ stance, improved });
  if (stanceOutcomes.length > STANCE_OUTCOME_CAP) stanceOutcomes.shift();
  profTrace('stance_outcome', { stance, improved });
};

/** r_sol proxy per stance: of the graded next attempts after it, the share
 *  that improved. */
export function stanceOutcomeRates(): Record<
  string,
  { n: number; improved: number; rate: number }
> {
  const out: Record<string, { n: number; improved: number; rate: number }> = {};
  for (const o of stanceOutcomes) {
    const e = (out[o.stance] ??= { n: 0, improved: 0, rate: 0 });
    e.n += 1;
    if (o.improved) e.improved += 1;
    e.rate = e.improved / e.n;
  }
  return out;
}

/** Test seam: clear the tally. */
export const resetStanceOutcomes = (): void => {
  stanceOutcomes.length = 0;
};
