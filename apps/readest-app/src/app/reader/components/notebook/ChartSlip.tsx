/**
 * ChartSlip — the data-chart slip (the charts-and-data wave).
 *
 * The professor emits only the ROWS ([CHART bar title:.. | A,3 | B,7]);
 * the desk draws them faithfully — bars or a line, ink axes, stamp the
 * sole accent. No chart library (no echarts/vega bundle), no canvas
 * element: SVG we render ourselves. The accuracy law governs the DATA —
 * the desk guarantees only that what he wrote is what you see.
 */
import React from 'react';

import type { ChartSpec } from '@/services/professor/professorTags';
import { useTranslation } from '@/hooks/useTranslation';

const W = 360;
const H = 220;
const PAD_L = 34;
const PAD_B = 26;
const PAD_T = 10;
const PAD_R = 10;

/** A readable tick step (1/2/5 × 10^n) for the value axis. */
const tickStep = (span: number, target = 4): number => {
  if (span <= 0) return 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
};

const ChartSlip: React.FC<{ spec: ChartSpec }> = ({ spec }) => {
  const _ = useTranslation();
  const { kind, title, rows } = spec;
  const values = rows.map((r) => r.value);
  const vMax = Math.max(0, ...values);
  const vMin = Math.min(0, ...values);
  const span = vMax - vMin || 1;
  const step = tickStep(span);
  const y0 = vMin - (vMin < 0 ? step * 0.5 : 0);
  const y1 = vMax + step * 0.5;
  const ySpan = y1 - y0 || 1;
  const xFor = (i: number) => PAD_L + ((i + 0.5) / rows.length) * (W - PAD_L - PAD_R);
  const yFor = (v: number) => PAD_T + (1 - (v - y0) / ySpan) * (H - PAD_T - PAD_B);

  const ticks: number[] = [];
  for (let t = Math.ceil(y0 / step) * step; t <= y1; t += step) ticks.push(Number(t.toFixed(10)));

  const barW = Math.min(44, ((W - PAD_L - PAD_R) / rows.length) * 0.6);
  const zeroY = yFor(0);

  return (
    <figure className='wb-chart' aria-label={title ?? _('A chart')}>
      <svg viewBox={`0 0 ${W} ${H}`} role='img'>
        {/* value gridlines + labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke='var(--ink)'
              strokeOpacity={t === 0 ? 0.55 : 0.14}
              strokeWidth='1'
            />
            <text x={PAD_L - 5} y={yFor(t) + 3} textAnchor='end' fontSize='8' fill='var(--muted)'>
              {t}
            </text>
          </g>
        ))}
        {kind === 'bar' &&
          rows.map((r, i) => {
            const x = xFor(i) - barW / 2;
            const y = yFor(Math.max(0, r.value));
            const h = Math.abs(yFor(r.value) - zeroY);
            return (
              <g key={r.label}>
                <rect x={x} y={y} width={barW} height={h} fill='var(--stamp)' fillOpacity='0.85' />
                <text
                  x={xFor(i)}
                  y={H - PAD_B + 12}
                  textAnchor='middle'
                  fontSize='8'
                  fill='var(--ink)'
                >
                  {r.label}
                </text>
                <text x={xFor(i)} y={y - 4} textAnchor='middle' fontSize='8' fill='var(--muted)'>
                  {r.value}
                </text>
              </g>
            );
          })}
        {kind === 'line' && (
          <>
            <polyline
              points={rows.map((r, i) => `${xFor(i)},${yFor(r.value)}`).join(' ')}
              fill='none'
              stroke='var(--stamp)'
              strokeWidth='1.6'
            />
            {rows.map((r, i) => (
              <g key={r.label}>
                <circle cx={xFor(i)} cy={yFor(r.value)} r='2.4' fill='var(--stamp)' />
                <text
                  x={xFor(i)}
                  y={H - PAD_B + 12}
                  textAnchor='middle'
                  fontSize='8'
                  fill='var(--ink)'
                >
                  {r.label}
                </text>
                <text
                  x={xFor(i)}
                  y={yFor(r.value) - 6}
                  textAnchor='middle'
                  fontSize='8'
                  fill='var(--muted)'
                >
                  {r.value}
                </text>
              </g>
            ))}
          </>
        )}
      </svg>
      {title && <figcaption className='wb-chart-title'>{title}</figcaption>}
    </figure>
  );
};

export default ChartSlip;
