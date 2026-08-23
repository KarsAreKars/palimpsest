/**
 * ProfOverlay — the "Hey Prof" bubble (HP-1, hey_prof_integration_plan §1).
 *
 * A minimal overlay at the foot of the reader: hold-tap mic (Web Speech
 * STT where available) or type; the professor's answer streams into the
 * bubble. No drawing yet (HP-2), no voice answers yet (HP-3) — this is the
 * PTT → context pack → streaming text loop.
 */
import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useProfessor } from '@/app/reader/hooks/useProfessor';
import { stripAnnotations } from '@/services/professor/annotations';

interface ProfOverlayProps {
  bookKey: string;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const getSpeechRecognition = (): (new () => SpeechRecognitionLike) | null => {
  const w = window as unknown as Record<string, unknown>;
  return (
    (w['SpeechRecognition'] as new () => SpeechRecognitionLike) ??
    (w['webkitSpeechRecognition'] as new () => SpeechRecognitionLike) ??
    null
  );
};

const ProfOverlay: React.FC<ProfOverlayProps> = ({ bookKey }) => {
  const { open, phase, answer, error, ask, close } = useProfessor({ bookKey });
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const SR = typeof window !== 'undefined' ? getSpeechRecognition() : null;

  useEffect(() => {
    if (!open) return undefined;
    setDraft('');
    // Focus after the open transition so the reader can talk/type at once.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  // Stop STT when the overlay closes or unmounts.
  useEffect(() => {
    if (!open && recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setListening(false);
    }
  }, [open]);
  useEffect(
    () => () => {
      recognitionRef.current?.abort();
    },
    [],
  );

  if (!open) return null;

  const toggleListen = () => {
    if (!SR) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const alt = last?.[0];
      if (alt) setDraft(alt.transcript);
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const submit = () => {
    const q = draft.trim();
    if (!q || phase !== 'idle') return;
    setDraft('');
    void ask(q);
  };

  return (
    <div
      className='pointer-events-none absolute inset-x-0 bottom-24 z-50 flex justify-center px-4'
      data-testid='prof-overlay'
    >
      <div className='pointer-events-auto w-full max-w-xl rounded-2xl border border-base-content/10 bg-base-100/95 shadow-xl backdrop-blur'>
        <div className='flex items-center gap-2 border-b border-base-content/10 px-4 py-2'>
          <span
            className={clsx(
              'inline-block h-2.5 w-2.5 rounded-full transition-colors',
              phase === 'idle' && 'bg-emerald-500',
              phase === 'thinking' && 'animate-pulse bg-amber-500',
              phase === 'answering' && 'animate-pulse bg-sky-500',
            )}
            aria-hidden='true'
          />
          <span className='text-sm font-medium'>Professor</span>
          <span className='text-xs text-base-content/50'>
            {listening ? 'listening…' : phase === 'thinking' ? 'thinking…' : '⌥Space'}
          </span>
          <button
            type='button'
            className='btn btn-ghost btn-xs ml-auto'
            aria-label='Close professor'
            onClick={close}
          >
            ✕
          </button>
        </div>

        {(answer || error) && (
          <div className='max-h-48 overflow-y-auto px-4 py-3'>
            {error ? (
              <p className='text-sm text-error'>{error}</p>
            ) : (
              <p className='whitespace-pre-wrap text-sm leading-relaxed' data-testid='prof-answer'>
                {stripAnnotations(answer)}
              </p>
            )}
          </div>
        )}

        <div className='flex items-center gap-2 px-3 py-2'>
          {SR && (
            <button
              type='button'
              className={clsx('btn btn-ghost btn-sm', listening && 'text-error')}
              aria-label={listening ? 'Stop listening' : 'Speak your question'}
              onClick={toggleListen}
            >
              {listening ? '■' : '🎙'}
            </button>
          )}
          <input
            ref={inputRef}
            type='text'
            className='input input-sm flex-1 bg-transparent focus:outline-none'
            placeholder='Ask about what you are reading…'
            aria-label='Ask the professor'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') close();
            }}
          />
          <button
            type='button'
            className='btn btn-primary btn-sm'
            disabled={!draft.trim() || phase !== 'idle'}
            onClick={submit}
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfOverlay;
