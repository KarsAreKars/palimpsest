/**
 * wbShared — the shared presentational pieces of the workbench transcript
 * (audit R5). Prose, Slip, and VerdictChip were extracted UNCHANGED
 * (byte-identical props, markup, and class names) from the retired notebook
 * tab so the block renderers (DerivationSlip, DiagramSlip, DeskCanvas, and
 * later waves' controls) import them without reaching into a default-exported
 * tab. Pure move; no behavioral edit.
 */
import React from 'react';
import { Streamdown } from 'streamdown';
import { math as streamdownMath } from '@streamdown/math';

import { useTranslation } from '@/hooks/useTranslation';
import type { CheckStepVerdict } from '@/services/professor/mathCheck';

export const Prose: React.FC<{ text: string }> = ({ text }) => (
  <div className='wb-prose select-text'>
    <Streamdown
      remarkPlugins={[streamdownMath.remarkPlugin]}
      rehypePlugins={[streamdownMath.rehypePlugin]}
    >
      {normalizeProfessorMath(text)}
    </Streamdown>
  </div>
);

/**
 * Normalize the professor's mixed math into Streamdown/KaTeX-clean markdown.
 * The model emits a mishmash: `$$…$$` display blocks, bare `\(…\)` / `\[…\]`
 * delimiters, trailing `$$` on a raw-LaTeX line, and inline `$…$`. KaTeX's
 * remark plugin handles `$$…$$` and `$…$` but chokes on the rest ("Can't use
 * '$' in math mode") and on bare `\lim \frac` sitting OUTSIDE any math node
 * (renders as literal text). So:
 *   1. `\(…\)` → `$…$` and `\[…\]` → `$$…$$`
 *   2. `$$…$$` blocks: strip the delimiters, re-wrap, and discard any
 *      trailing `$$` that leaked INSIDE the body (the `$`-in-math ParseError)
 *   3. A line that is pure bare LaTeX (starts with `\` and has NO `$`) →
 *      wrap the whole line in `$$…$$` so it renders as display math
 */
export function normalizeProfessorMath(text: string): string {
  // \(…\) → $…$   \[…\] → $$…$$
  let out = text
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$');

  // $$…$$ blocks: strip and re-wrap; drop stray trailing $$ INSIDE the body.
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_m, body: string) => {
    const cleaned = body.replace(/\$+/g, '').trim();
    return cleaned ? `$${cleaned}$` : '';
  });

  // A whole line of pure bare LaTeX (starts with \, no $ left) → $$…$$
  out = out
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('\\') && !t.includes('$') && /\\(frac|lim|sum|int|sqrt|d|partial)/.test(t)) {
        return `$$${t}$$`;
      }
      return line;
    })
    .join('\n');

  return out;
}

/** The paper slip under a chip (hover-only; the aria-label carries the same
 *  words for everyone else). */
export const Slip: React.FC<{ children: React.ReactNode; label?: string }> = ({
  children,
  label,
}) => (
  <span className='wb-slip' aria-hidden='true'>
    {label && <span className='wb-slip-label'>{label}</span>}
    <span className='wb-slip-quote'>{children}</span>
  </span>
);

export const VerdictChip: React.FC<{ verdict: CheckStepVerdict }> = ({ verdict }) => {
  const _ = useTranslation();
  const cx = verdict.counterexample;
  const assigns = cx
    ? Object.entries(cx.assignments)
        .map(([k, val]) => `${k} = ${String(val)}`)
        .join(', ')
    : '';
  const counterexampleCopy = cx
    ? assigns
      ? _('For {{assigns}}, the left side reads {{prev}} while this line reads {{step}}.', {
          assigns,
          prev: cx.prevValue,
          step: cx.stepValue,
        })
      : _('The left side reads {{prev}} while this line reads {{step}}.', {
          prev: cx.prevValue,
          step: cx.stepValue,
        })
    : '';

  let glyph = '◌';
  let tone = 'wb-chip-muted';
  let label = _('Unmarked');
  let tip: string = _('The professor will take a moment.');
  if (verdict.status === 'parse_error') {
    label = _('Parse error');
    tip = _('Could not read this line as math.');
  } else {
    switch (verdict.verdict) {
      case 'equivalent':
      case 'equivalent_same_roots':
        glyph = '✓';
        tone = 'wb-chip-sage';
        label = _('Checks out');
        tip = _('This line checks out.');
        break;
      case 'implied_forward':
      case 'implied_backward':
        glyph = '✓';
        tone = 'wb-chip-sage';
        label = _('Holds in one direction');
        tip = _('This line holds in one direction.');
        break;
      case 'not_equivalent':
        glyph = '✗';
        tone = 'wb-chip-stamp';
        label = _('Does not follow');
        tip = counterexampleCopy || label;
        break;
      default:
        break;
    }
  }
  return (
    <span
      className={`wb-chip ${tone}${verdict.status === 'parse_error' ? ' wb-chip-parse' : ''}`}
      role='img'
      aria-label={label}
    >
      <span aria-hidden='true'>{glyph}</span>
      {tip && <Slip>{tip}</Slip>}
    </span>
  );
};
