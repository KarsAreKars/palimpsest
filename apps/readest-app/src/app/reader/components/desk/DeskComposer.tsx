/**
 * DeskComposer — the floating mini-composer on the sheet (d2 §7).
 *
 * A positioned plate (role='dialog') that opens exactly where a tail click
 * placed it: Newsreader textarea on transparent paper, the ƒx MathLive
 * affordance, and the commit stamp. Enter sends; Shift+Enter inserts a
 * newline; ⌘/Ctrl+Enter also sends; Escape dismisses and returns focus to
 * the sheet container (d2 §7.2, audit R10 — the composer's root
 * stopPropagation is what keeps the desk-level Esc from nuking the desk
 * while text is on the plate).
 *
 * The ƒx popover is the SAME popover markup the pinned bar used (2.x §6.1):
 * .wb-popover-overlay + .wb-math-popover + MathField, with the step/justify
 * pair when a folio is open, re-anchored to the floating composer. MathLive
 * mounts via next/dynamic ssr:false — the hard loading rule is absolute.
 */
'use client';

import React, { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

import { useTranslation } from '@/hooks/useTranslation';
import type { ComposerState } from './deskGeometry';

// MathLive touches `window` at definition time — the hard next/dynamic
// ssr:false rule (2026-09-06). The popover mounts it lazily on first open.
const MathField = dynamic(() => import('../notebook/MathField'), { ssr: false });

export interface DeskComposerProps {
  /** placed | composing — 'sending' unmounts the plate (d2 §7.1 SEND). */
  state: Extract<ComposerState, { kind: 'placed' | 'composing' }>;
  /** Viewport-clamped plate position (DeskCanvas runs clampComposerPosition). */
  position: { left: number; top: number };
  sessionActive: boolean;
  /** A folio is open while the last professor block carries a derivation —
   *  the ƒx popover then offers the step/justify pair (s3 §7.3). */
  folioOpen: boolean;
  onFocus: () => void;
  onChange: (text: string) => void;
  /** Commit the text on the plate (the caller owns the send pipeline). */
  onSend: () => void;
  /** Escape/dismiss: clear the plate, return focus to the sheet container. */
  onDismiss: () => void;
}

const DeskComposer: React.FC<DeskComposerProps> = ({
  state,
  position,
  sessionActive,
  folioOpen,
  onFocus,
  onChange,
  onSend,
  onDismiss,
}) => {
  const _ = useTranslation();
  const text = state.kind === 'composing' ? state.text : '';
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // The plate owns the keys the moment it exists — without auto-focus the
  // keystrokes fall through to the header's focused button (owner dogfood:
  // "nothing I type seems to be working").
  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  const composerRows = Math.min(5, Math.max(1, text.split('\n').length));

  // ── The ƒx popover (MathLive composer) — the 2.x markup, re-anchored ──
  const [mathOpen, setMathOpen] = useState(false);
  const [mathValue, setMathValue] = useState('');
  const [justifyValue, setJustifyValue] = useState('');

  const closeMath = useCallback(() => {
    setMathOpen(false);
    setMathValue(''); // never reopen with stale content
    setJustifyValue('');
  }, []);

  const openMath = useCallback(() => {
    setMathValue('');
    setJustifyValue('');
    setMathOpen(true);
  }, []);

  /** Splice a snippet into the textarea at the caret (shared by the single
   *  expression insert and the step/justify pair commit — s3 §7.3). */
  const spliceAtCaret = useCallback(
    (snippet: string) => {
      const ta = textareaRef.current;
      const start = ta?.selectionStart ?? text.length;
      const end = ta?.selectionEnd ?? text.length;
      onChange(text.slice(0, start) + snippet + text.slice(end));
      const caret = start + snippet.length;
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(caret, caret);
      });
    },
    [text, onChange],
  );

  const insertMath = useCallback(() => {
    const latex = mathValue.trim();
    if (latex) {
      // Display-sized expressions (multi-line environments, explicit
      // \displaystyle, matrix/cases rows) get $$…$$; the rest rides inline.
      const display = /\\displaystyle|\\begin\{|\\\\|\n/.test(latex);
      spliceAtCaret(display ? `$$${latex}$$` : `$${latex}$`);
    }
    closeMath();
  }, [mathValue, spliceAtCaret, closeMath]);

  /** Pair mode commit: the step and its justification splice into the
   *  composer as `$$…$$\nwhy` — the send path re-associates them with the
   *  open folio (s3 §7.3). */
  const insertStepPair = useCallback(() => {
    const latex = mathValue.trim();
    if (latex) {
      const justification = justifyValue.trim();
      spliceAtCaret(justification ? `$$${latex}$$\n${justification}` : `$$${latex}$$`);
    }
    closeMath();
  }, [mathValue, justifyValue, spliceAtCaret, closeMath]);

  const commitPopover = folioOpen ? insertStepPair : insertMath;

  const handleMathPopoverKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'MATH-FIELD') {
      e.preventDefault();
      commitPopover();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMath();
      textareaRef.current?.focus();
    }
  };

  const handleJustifyKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertStepPair();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMath();
      textareaRef.current?.focus();
    }
  };

  // ── Keys (d2 §7.2): Enter sends; Shift+Enter newline; Escape dismisses ──
  const handleComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline. ⌘/Ctrl+Enter also sends.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Audit R10: while the composer is not idle, Escape is the composer's —
  // stopPropagation keeps the sheet-level useShortcuts listener from
  // dismissing the whole desk (and dropping the text).
  const handleRootKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (!mathOpen) onDismiss();
  };

  return (
    <div
      className='desk-composer'
      style={{ left: position.left, top: position.top }}
      role='dialog'
      aria-label={_('Write on the sheet')}
      onKeyDown={handleRootKeyDown}
      onClick={() => textareaRef.current?.focus()}
    >
      {mathOpen && (
        <>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions*/}
          <div className='wb-popover-overlay' onClick={closeMath} />
          <div
            className='wb-math-popover'
            role='dialog'
            aria-label={_('Compose math')}
            onKeyDown={handleMathPopoverKey}
          >
            {folioOpen ? (
              <div className='wb-step-pair'>
                <MathField
                  value={mathValue}
                  onChange={setMathValue}
                  compact
                  autoFocus
                  placeholder={_('Write an expression…')}
                />
                <input
                  type='text'
                  className='wb-justify-input'
                  value={justifyValue}
                  aria-label={_('Justify the step')}
                  placeholder={_('Why is this step allowed?…')}
                  onChange={(e) => setJustifyValue(e.target.value)}
                  onKeyDown={handleJustifyKey}
                />
              </div>
            ) : (
              <MathField
                value={mathValue}
                onChange={setMathValue}
                placeholder={_('Write an expression…')}
              />
            )}
            <div className='wb-math-actions'>
              <button type='button' className='ink-btn' onClick={commitPopover}>
                {_('Add to page')}
              </button>
            </div>
          </div>
        </>
      )}
      <textarea
        ref={textareaRef}
        rows={composerRows}
        value={text}
        aria-label={_('Write to the professor')}
        placeholder={sessionActive ? _('Continue the argument…') : _('Place your writing…')}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleComposerKey}
      />
      <div className='desk-composer-row'>
        <button
          type='button'
          className='wb-fx'
          aria-label={_('Insert math')}
          title={_('Insert math')}
          onClick={openMath}
        >
          ƒx
        </button>
        <button type='button' className='ink-btn' onClick={onSend}>
          {_('Add to page')}
        </button>
      </div>
    </div>
  );
};

export default DeskComposer;
