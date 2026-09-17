/**
 * PlotSlip — the computed plot slip (the computed-plot wave).
 *
 * The professor emits only the RULE ([PLOT f:x^2]); the desk samples the
 * curve itself (plotCompute — accuracy by construction) and draws an SVG
 * polyline. No chart library (no echarts/vega bundle), no canvas element:
 * an SVG we render ourselves, panned by dragging and zoomed with the
 * wheel via pointer events (DeskCanvas's drag idiom). Ink axes, stamp
 * first curve, sage second, muted third — the Antiquarian world. Same
 * slip chrome as DiagramSlip (caption under it). Nothing here
 * transitions, so reduced-motion needs no override.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import {
  evaluatePlotSpec,
  PLOT_SAMPLE_COUNT,
  sampleFunction,
  type PlotSample,
  type PlotSpec,
} from './plotCompute';
import { Prose } from './wbShared';

/** Fixed drawing surface (SVG viewBox units). */
const W = 360;
const H = 240;
const PAD = 10;

/** Curve inks: stamp for the first rule, sage for the second, muted for
 *  the rest — stamp stays the SOLE accent (fn2/fn3 are state inks). */
const TRACE_INKS = ['var(--stamp)', 'var(--sage)', 'var(--muted)'];

/** Zoom guard rails: the window never collapses to a point nor blows out
 *  to astronomia. */
const MIN_SPAN = 1e-9;
const MAX_SPAN = 1e9;

interface View {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** The opening window: the spec's x-range; y from the first sample pass,
 *  padded 12% top and bottom, absurd pole extents clamped to something
 *  drawable, degenerate extents nudged open. */
const initialView = (spec: PlotSpec): View | null => {
  const result = evaluatePlotSpec(spec);
  if (!result) return null;
  const [xMin, xMax] = result.range;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const t of result.traces) {
    for (const p of t.points) {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  yMin = Math.max(yMin, -1e4);
  yMax = Math.min(yMax, 1e4);
  if (yMax - yMin < 1e-6) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.12;
  return { xMin, xMax, yMin: yMin - pad, yMax: yMax + pad };
};

/** 1-2-5 "nice" tick spacing for a span. */
const niceStep = (span: number, target: number): number => {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
};

const ticksFor = (lo: number, hi: number, target = 5): { v: number; label: string }[] => {
  const step = niceStep(hi - lo, target);
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
  const out: { v: number; label: string }[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    const snapped = Math.abs(v) < step * 1e-9 ? 0 : v;
    out.push({ v: snapped, label: snapped.toFixed(decimals) });
  }
  return out;
};

const PlotSlip: React.FC<{ spec: PlotSpec }> = ({ spec }) => {
  const _ = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);
  // The spec key resets the learner's pan/zoom when the professor's rules
  // change (a re-committed slip is a new drawing).
  const specKey = `${spec.fns.join(';')}|${spec.range?.join(',') ?? ''}`;
  const base = useMemo(() => initialView(spec), [specKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<View | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => setView(null), [specKey]);
  const v = view ?? base;

  // Wheel zoom — native listener with passive:false so the desk's scroll
  // does not fight the learner's pinch (React's onWheel is passive).
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !v) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      setView((cur) => {
        const w = cur ?? base;
        if (!w) return cur;
        const k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
        const spanX = Math.min(MAX_SPAN, Math.max(MIN_SPAN, (w.xMax - w.xMin) * k));
        const spanY = Math.min(MAX_SPAN, Math.max(MIN_SPAN, (w.yMax - w.yMin) * k));
        const cx = w.xMin + fx * (w.xMax - w.xMin);
        const cy = w.yMax - fy * (w.yMax - w.yMin); // screen y is flipped
        return {
          xMin: cx - fx * spanX,
          xMax: cx + (1 - fx) * spanX,
          yMin: cy - (1 - fy) * spanY,
          yMax: cy + fy * spanY,
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [base, v]);

  // Pointer pan (DeskCanvas idiom): the curve follows the pointer 1:1 —
  // dragging right looks left. Capture keeps the drag alive off-slip.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!v) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, view: v };
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const dx = ((ev.clientX - start.x) / rect.width) * (start.view.xMax - start.view.xMin);
      const dy = ((ev.clientY - start.y) / rect.height) * (start.view.yMax - start.view.yMin);
      setView({
        xMin: start.view.xMin - dx,
        xMax: start.view.xMax - dx,
        yMin: start.view.yMin + dy,
        yMax: start.view.yMax + dy,
      });
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      setDragging(false);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  // Degraded mount (belt and braces — the commit path already filters):
  // the rules stand as typeset words with a muted note, never an empty
  // box, never a crash (the DiagramSlip pattern).
  if (!v) {
    return (
      <div className='wb-figure-degraded'>
        <Prose text={spec.fns.map((f) => `$$${f}$$`).join('\n')} />
        <p className='wb-figure-missing'>{_('The plot could not be mounted.')}</p>
      </div>
    );
  }

  const sx = (x: number): number => PAD + ((x - v.xMin) / (v.xMax - v.xMin)) * (W - 2 * PAD);
  const sy = (y: number): number => H - PAD - ((y - v.yMin) / (v.yMax - v.yMin)) * (H - 2 * PAD);

  // Resample every rule over the CURRENT window — the desk computes the
  // curve at whatever magnification the learner chooses. A jump taller
  // than two screens is a pole: the pen lifts instead of streaking.
  const toPath = (pts: PlotSample[]): string => {
    let d = '';
    let prevY = 0;
    let pen = false;
    for (const p of pts) {
      const X = sx(p.x);
      const Y = Math.max(-H * 4, Math.min(H * 5, sy(p.y)));
      if (pen && Math.abs(Y - prevY) > H * 2) pen = false;
      d += `${pen ? 'L' : 'M'}${X.toFixed(2)},${Y.toFixed(2)}`;
      prevY = Y;
      pen = true;
    }
    return d;
  };

  const axisY = v.yMin <= 0 && v.yMax >= 0 ? sy(0) : H - PAD; // x-axis
  const axisX = v.xMin <= 0 && v.xMax >= 0 ? sx(0) : PAD; // y-axis
  const xTicks = ticksFor(v.xMin, v.xMax);
  const yTicks = ticksFor(v.yMin, v.yMax);

  return (
    <figure
      className='wb-figure wb-plot'
      role='img'
      aria-label={_('Computed plot of {{fns}}', { fns: spec.fns.join(', ') })}
    >
      <div className='wb-figure-svg wb-plot-svg'>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={dragging ? 'wb-plot-dragging' : undefined}
          onPointerDown={onPointerDown}
        >
          <line className='wb-plot-axis' x1={PAD} y1={axisY} x2={W - PAD} y2={axisY} />
          <line className='wb-plot-axis' x1={axisX} y1={PAD} x2={axisX} y2={H - PAD} />
          {xTicks.map((t) => (
            <g key={`x${t.v}`}>
              <line
                className='wb-plot-tick'
                x1={sx(t.v)}
                y1={axisY - 3}
                x2={sx(t.v)}
                y2={axisY + 3}
              />
              <text className='wb-plot-label' x={sx(t.v)} y={axisY + 12} textAnchor='middle'>
                {t.label}
              </text>
            </g>
          ))}
          {yTicks.map((t) => (
            <g key={`y${t.v}`}>
              <line
                className='wb-plot-tick'
                x1={axisX - 3}
                y1={sy(t.v)}
                x2={axisX + 3}
                y2={sy(t.v)}
              />
              <text className='wb-plot-label' x={axisX + 5} y={sy(t.v) - 3}>
                {t.label}
              </text>
            </g>
          ))}
          {spec.fns.map((latex, i) => {
            const pts = sampleFunction(latex, [v.xMin, v.xMax], PLOT_SAMPLE_COUNT);
            if (!pts) return null;
            return (
              <path
                key={latex}
                d={toPath(pts)}
                fill='none'
                stroke={TRACE_INKS[Math.min(i, TRACE_INKS.length - 1)]}
                strokeWidth={1.6}
                strokeLinejoin='round'
                strokeLinecap='round'
              />
            );
          })}
        </svg>
      </div>
      <figcaption className='wb-figure-caption'>
        {spec.fns.map((f) => `y = ${f}`).join(' · ')}
        <span className='wb-plot-hint'>
          {_('Computed by the desk — drag to pan, scroll to zoom.')}
        </span>
      </figcaption>
    </figure>
  );
};

export default PlotSlip;
