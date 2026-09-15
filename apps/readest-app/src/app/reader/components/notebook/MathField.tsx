/**
 * MathField — a thin React wrapper around MathLive's <math-field> web
 * component, themed to the Apothecary palette (ink on paper, stamp caret).
 *
 * HARD LOADING RULE (2026-09-06 lesson): this module imports 'mathlive',
 * which touches `window` at definition time. The consumer must therefore
 * mount it via next/dynamic with `ssr: false` (WorkbenchTab does) — never
 * import this file from a server-rendered path.
 */
import React, { useEffect, useRef } from 'react';
import 'mathlive';
import { MathfieldElement } from 'mathlive';

// KaTeX-font files served from the app's public/fonts/mathlive (vendored
// from node_modules/mathlive/fonts at M1) — the bundled build cannot resolve
// mathlive's default './fonts/' relative to its script URL.
// Sounds off entirely: a typeset desk never clicks (macOS desktop app).
if (typeof window !== 'undefined' && typeof MathfieldElement !== 'undefined') {
  MathfieldElement.fontsDirectory = '/fonts/mathlive/';
  MathfieldElement.soundsDirectory = null;
  MathfieldElement.keypressSound = null;
}

type MathFieldDomProps = React.DetailedHTMLProps<
  React.HTMLAttributes<MathfieldElement> & {
    'virtual-keyboard-mode'?: string;
    'math-virtual-keyboard-policy'?: string;
    'read-only'?: boolean;
    placeholder?: string;
  },
  MathfieldElement
>;

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'math-field': MathFieldDomProps;
    }
  }
}

export interface MathFieldProps {
  /** LaTeX value. Controlled: the field is re-synced when this differs. */
  value: string;
  onChange?: (latex: string) => void;
  /** Fired on blur and on Enter — the "commit" gesture for a step. */
  onCommit?: (latex: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  /** Focus the field on mount — the pair-mode popover is keyboard-first. */
  autoFocus?: boolean;
  /** Compact face (min-height 1.4rem) for the step/justify pair mode. */
  compact?: boolean;
}

/**
 * math-virtual-keyboard-policy="manual" = the virtual keyboard never pops
 * (macOS desktop; there is no code path that calls show()). default-mode
 * stays 'math' (strict math parsing, no text mode).
 */
const MathField: React.FC<MathFieldProps> = ({
  value,
  onChange,
  onCommit,
  placeholder,
  readOnly = false,
  autoFocus = false,
  compact = false,
}) => {
  const ref = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;

  // Bind once per element; the refs above keep callbacks live.
  useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    const handleInput = () => onChangeRef.current?.(mf.getValue('latex'));
    const handleCommit = () => onCommitRef.current?.(mf.getValue('latex'));
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) handleCommit();
    };
    mf.addEventListener('input', handleInput);
    mf.addEventListener('blur', handleCommit);
    mf.addEventListener('keydown', handleKeydown);
    return () => {
      mf.removeEventListener('input', handleInput);
      mf.removeEventListener('blur', handleCommit);
      mf.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  // Controlled sync: push external changes (store edits, proposals) into the
  // field silently (silenceNotifications — no input-event echo).
  useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    if (mf.getValue('latex') !== value) {
      mf.setValue(value, { silenceNotifications: true });
    }
  }, [value]);

  // Pair mode is keyboard-first: focus on mount when asked.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <math-field
      ref={ref}
      className={`workbench-math-field${compact ? ' workbench-math-field-compact' : ''}`}
      virtual-keyboard-mode='off'
      math-virtual-keyboard-policy='manual'
      read-only={readOnly || undefined}
      placeholder={placeholder}
    />
  );
};

export default MathField;
