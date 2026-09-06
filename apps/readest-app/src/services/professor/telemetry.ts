/**
 * profTelemetry — one structured trace across the whole Prof loop:
 *   open → input (typewhisper/voice) → stt → ask → llm (ttft) → voice
 *   (first audio) → ink → done/error.
 * Every event logs `[prof] +<ms> <event> <json>` to the app log and lands
 * in a ring buffer dumped on error, so a bug report is "read the log",
 * never "describe what you saw".
 */

type TelemetryData = Record<string, unknown>;

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
  console.info(`[prof] +${ms}ms ${event}`, data ?? '');
};

/** Dump the recent trail on failure — the report reads itself. */
export const profTraceDump = (why: string, err?: unknown) => {
  console.warn(`[prof] FAILED: ${why}`, err ?? '');
  console.warn(
    '[prof] trail:\n' +
      ring.map((r) => `  +${r.ms}ms ${r.event} ${r.data ? JSON.stringify(r.data) : ''}`).join('\n'),
  );
};
