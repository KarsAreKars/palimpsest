/**
 * ProfOverlay — the Prof's presence, distilled to one object: a text field.
 *
 * The user dictates through TypeWhisper (system-level — it owns the mic,
 * the STT, and its own waveform UI), so the overlay doesn't touch the mic
 * at all. ⌥Space opens the field focused; ⌥Space again (or Enter) asks;
 * Esc dismisses. He answers by voice (Kokoro) + ink on the page; the only
 * text on screen is a one-line auto-fading subtitle. The persistent record
 * is the margin note (A5).
 *
 * (The audio-reactive blob lived here briefly — removed 2026-09-06 on user
 * call: TypeWhisper already gives listening feedback; the blob was a second,
 * worse waveform. ProfBlob.tsx stays on disk unused, for reference.)
 */
import React, { useEffect, useRef, useState } from 'react';
import { useProfessor } from '@/app/reader/hooks/useProfessor';
import { stripAnnotations } from '@/services/professor/annotations';
import { profTrace, profTraceReset } from '@/services/professor/telemetry';
import { PaperField } from '@/components/apothecary';

interface ProfOverlayProps {
  bookKey: string;
}

/** The one-line subtitle: the tail of the streamed answer. */
const lastLine = (answer: string): string => {
  const clean = stripAnnotations(answer).replace(/\s+/g, ' ').trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  const tail = sentences?.slice(-1)[0] ?? clean;
  return tail.length > 140 ? `…${tail.slice(-137)}` : tail;
};

const ProfOverlay: React.FC<ProfOverlayProps> = ({ bookKey }) => {
  const { open, phase, answer, error, ask, close, interrupt } = useProfessor({ bookKey });
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (q?: string) => {
    const question = (q ?? draft).trim();
    if (!question || phase !== 'idle') return;
    profTrace('ask', { q: question });
    setDraft('');
    void ask(question);
  };

  // Open = focus the field, ready for TypeWhisper or typing.
  useEffect(() => {
    if (!open) return undefined;
    profTraceReset();
    profTrace('open', { mode: 'text' });
    setDraft('');
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ⌥Space while open: text → ask; empty → close.
  useEffect(() => {
    const onRelease = () => {
      if (draft.trim()) submit();
      else close();
    };
    window.addEventListener('prof-release', onRelease);
    return () => window.removeEventListener('prof-release', onRelease);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, phase]);

  if (!open) return null;

  const speaking = phase === 'answering';
  const thinking = phase === 'thinking';

  return (
    <>
      {/* the 5% dim — the page recedes while the Prof is present */}
      <div className='pointer-events-none fixed inset-0 z-40 bg-black/[0.05] transition-opacity' />

      <div
        className='pointer-events-none absolute inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4'
        data-testid='prof-overlay'
      >
        {/* status line — typed, muted; the only "chrome" */}
        {thinking && (
          <div className='typed text-stamp animate-pulse text-[10px]'>THINKING…</div>
        )}
        {error && <div className='typed text-stamp max-w-lg truncate text-[10px]'>{error}</div>}

        <div className='pointer-events-auto flex items-center gap-3'>
          {/* the ask card: a cataloguer's plate, lifted — the field and
              the dismiss key sit inside the hairline frame */}
          <div className='plate chrome-lift flex items-center gap-3 px-3 py-2'>
            <PaperField
              ref={inputRef}
              type='text'
              className='w-80 text-sm'
              placeholder='ASK — OR DICTATE WITH TYPEWHISPER…'
              aria-label='Ask the professor'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // No stopPropagation for ⌥Space — but the field swallows it
                // before the window listener, so handle release right here:
                if (e.code === 'Space' && e.altKey) {
                  e.preventDefault();
                  if (draft.trim()) submit();
                  else close();
                  return;
                }
                e.stopPropagation();
                if (e.key === 'Enter') submit();
                else if (e.key === 'Escape') close();
              }}
            />
            <button
              type='button'
              className='typed text-mutedink hover:text-ink text-[9px]'
              aria-label='Dismiss professor'
              onClick={() => {
                interrupt();
                close();
              }}
            >
              ESC ✕
            </button>
          </div>
        </div>
      </div>

      {/* the subtitle: one line at the bottom edge while he speaks.
          The lasting record is the margin note, not this caption. */}
      {speaking && answer && (
        <div className='pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-6'>
          <p
            className='plate chrome-lift text-ink max-w-2xl truncate px-4 py-2 text-center text-[13px] italic opacity-90'
            data-testid='prof-caption'
          >
            {lastLine(answer)}
          </p>
        </div>
      )}
    </>
  );
};

export default ProfOverlay;
