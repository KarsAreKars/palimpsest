/**
 * plotCompute — computed function plots (the computed-plot wave).
 *
 * The professor emits ONLY the rule ([PLOT f:x^2]); the desk evaluates the
 * function ITSELF — LaTeX → MathLive Compute Engine → compiled numeric
 * evaluator → sampled points. The curve is computed, never drawn from
 * imagination (the accuracy law). Model-drawn data is never trusted.
 *
 * Pure and DOM-free (@cortex-js/compute-engine is node-safe — already a
 * dependency through MathField's mathlive): vitest-able, importable from
 * the commit path without the hard loading rule that guards 'mathlive'.
 */
import { ComputeEngine, compile } from '@cortex-js/compute-engine';

/** A plot spec as parsed from [PLOT f:..] — LaTeX rules + optional range. */
export interface PlotSpec {
  fns: string[];
  range?: [number, number];
}

export interface PlotSample {
  x: number;
  y: number;
}

export interface PlotTrace {
  latex: string;
  points: PlotSample[];
}

export interface PlotEvaluation {
  range: [number, number];
  traces: PlotTrace[];
}

/** The window a range-less [PLOT] opens on. */
export const PLOT_DEFAULT_RANGE: [number, number] = [-6, 6];
/** Odd, so a symmetric range samples x = 0 exactly; endpoints included. */
export const PLOT_SAMPLE_COUNT = 201;

let engine: ComputeEngine | null = null;
const getEngine = (): ComputeEngine => (engine ??= new ComputeEngine());

/** Compile a LaTeX rule into a numeric evaluator of x. null when the rule
 *  does not compile — garbage LaTeX degrades, never throws. Non-finite or
 *  non-number results (poles, booleans from an equation) surface as NaN so
 *  the sampler can lift the pen there. */
const compileRule = (latex: string): ((x: number) => number) | null => {
  try {
    const parsed = getEngine().parse(latex);
    const compiled = compile(parsed, { realOnly: true });
    if (!compiled.success || typeof compiled.run !== 'function') return null;
    const run = compiled.run;
    return (x: number): number => {
      try {
        const v: unknown = run({ x });
        return typeof v === 'number' ? v : NaN;
      } catch {
        return NaN;
      }
    };
  } catch {
    return null;
  }
};

/** One evaluation — point probes and the correctness contract. null when
 *  the rule does not compile or the value is not finite. */
export function evaluateFunctionAt(latex: string, x: number): number | null {
  const f = compileRule(latex);
  if (!f) return null;
  const y = f(x);
  return Number.isFinite(y) ? y : null;
}

/** Sample a rule over [lo, hi] at `count` points (endpoints included).
 *  Non-finite values are dropped individually — the curve lifts its pen at
 *  a pole instead of refusing to draw. null when the rule does not compile
 *  or yields NO finite sample at all (the degradation signal). */
export function sampleFunction(
  latex: string,
  range: [number, number],
  count: number = PLOT_SAMPLE_COUNT,
): PlotSample[] | null {
  const f = compileRule(latex);
  if (!f) return null;
  const [lo, hi] = range;
  const n = Math.max(2, Math.floor(count));
  const points: PlotSample[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = lo + ((hi - lo) * i) / (n - 1);
    const y = f(x);
    if (Number.isFinite(y)) points.push({ x, y });
  }
  return points.length > 0 ? points : null;
}

/** Evaluate a whole spec: every rule sampled over the spec's range (the
 *  default window when none was given). Rules that fail drop out
 *  individually; null only when NO rule produced a trace — the commit
 *  path reads that as "the figure slot is consumed, the ink did not
 *  hold" (the diagram self-check pattern). */
export function evaluatePlotSpec(spec: PlotSpec): PlotEvaluation | null {
  const range = spec.range ?? PLOT_DEFAULT_RANGE;
  const traces: PlotTrace[] = [];
  for (const latex of spec.fns) {
    const points = sampleFunction(latex, range);
    if (points) traces.push({ latex, points });
  }
  return traces.length > 0 ? { range, traces } : null;
}
