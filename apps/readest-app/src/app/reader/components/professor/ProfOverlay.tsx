/**
 * ProfOverlay — the orb (UX_VISION §A). The Prof is a PRESENCE, not a chat
 * box: he speaks, ink is his handwriting, text is subtitles.
 *
 * States:
 *   listening  — voice mode default. Orb rises, page dims 5%, recording
 *                starts immediately; ghost-transcript streams underneath.
 *   thinking   — stamp-red pulse while the vision pack + LLM run.
 *   speaking   — Kokoro talks; ink strikes the page in sync; a single-line
 *                auto-fading caption rides the bottom edge. Talking over him
 *                (orb click / hotkey) barges in: he stops and listens.
 *   text mode  — mic⇄keyboard toggle in the orb swaps the transcript for a
 *                PaperField (persisted). Keyboard users keep HP-1's input.
 *
 * The persistent written record is the margin note (A5), not this overlay.
 */
import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useProfessor } from '@/app/reader/hooks/useProfessor';
import { stripAnnotations } from '@/services/professor/annotations';
import { PaperField } from '@/components/apothecary';

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

const INPUT_MODE_KEY = 'palimpsest-prof-input-mode';
const STT_BASE = 'http://127.0.0.1:8737';
type InputMode = 'voice' | 'text';

const loadInputMode = (): InputMode => {
  try {
    return localStorage.getItem(INPUT_MODE_KEY) === 'text' ? 'text' : 'voice';
  } catch {
    return 'voice';
  }
};

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
  const [listening, setListening] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('voice');
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const SR = typeof window !== 'undefined' ? getSpeechRecognition() : null;

  useEffect(() => {
    setInputMode(loadInputMode());
  }, []);
  const setMode = (m: InputMode) => {
    setInputMode(m);
    try {
      localStorage.setItem(INPUT_MODE_KEY, m);
    } catch {
      /* private mode */
    }
  };

  /** Whisper = transcript authority (sidecar /stt). Web Speech only feeds
      the live ghost transcript while you speak — it never submits. On any
      /stt failure the Web Speech final transcript is the fallback. */
  const transcribeAndSubmit = (blob: Blob, fallback: string) => {
    fetch(`${STT_BASE}/stt`, { method: 'POST', body: blob })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        const { text } = (await res.json()) as { text: string };
        const q = (text || fallback).trim();
        if (q) submit(q);
      })
      .catch(() => {
        const q = fallback.trim();
        if (q) submit(q);
      });
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start();
      recorderRef.current = rec;
    } catch {
      recorderRef.current = null; // mic denied — Web Speech still carries it
    }
  };

  const stopRecording = (submit: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) return;
    rec.onstop = () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      if (!submit) return;
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
      if (blob.size > 0) {
        setDraft((d) => {
          transcribeAndSubmit(blob, d);
          return d;
        });
      }
    };
    rec.stop();
  };

  const stopListening = (wantsSubmit: boolean) => {
    const hadRecorder = !!recorderRef.current;
    stopRecording(wantsSubmit);
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) rec.stop();
    setListening(false);
    if (wantsSubmit && !hadRecorder) {
      // Mic denied → no Whisper; the Web Speech ghost transcript submits.
      setDraft((d) => {
        const q = d.trim();
        if (q) setTimeout(() => submit(q), 0);
        return d;
      });
    }
  };

  const submit = (q?: string) => {
    const question = (q ?? draft).trim();
    if (!question || phase !== 'idle') return;
    setDraft('');
    void ask(question);
  };

  const startListening = () => {
    if (!SR || listening) return;
    if (phase === 'answering' || phase === 'thinking') interrupt();
    void startRecording(); // Whisper's ear, in parallel with ghost partials
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
      // Ghost-partials only: submission belongs to Whisper (/stt) via
      // stopRecording — Web Speech is the fallback text, never the sender.
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    setDraft('');
    setListening(true);
    rec.start();
  };

  // Open = summon: in voice mode, recording starts immediately (no "click
  // mic" step). In text mode, focus the field instead.
  useEffect(() => {
    if (!open) return undefined;
    setDraft('');
    if (inputMode === 'voice' && SR) {
      const t = setTimeout(startListening, 80);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Stop STT when the overlay closes or unmounts.
  useEffect(() => {
    if (!open && recognitionRef.current) stopListening(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => recognitionRef.current?.abort(), []);

  if (!open) return null;

  const speaking = phase === 'answering';
  const thinking = phase === 'thinking';

  /** Clicking the orb = the one gesture for everything: release-to-ask while
      listening, barge-in while he speaks, summon-to-listen when idle. */
  const orbClick = () => {
    if (inputMode === 'text') return;
    if (listening) stopListening(true);
    else if (speaking || thinking) {
      interrupt();
      startListening();
    } else startListening();
  };

  return (
    <>
      {/* the 5% dim — the page recedes while the Prof is present */}
      <div className='pointer-events-none fixed inset-0 z-40 bg-black/[0.05] transition-opacity' />

      <div
        className='pointer-events-none absolute inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4'
        data-testid='prof-overlay'
      >
        {/* ghost transcript / status line — typed, muted */}
        {(listening && draft) || thinking ? (
          <div className='typed text-mutedink max-w-lg truncate text-[10px]'>
            {thinking ? 'THINKING…' : draft}
          </div>
        ) : null}

        <div className='pointer-events-auto flex items-center gap-3'>
          {/* the orb */}
          {inputMode === 'voice' && (
            <button
              type='button'
              onClick={orbClick}
              aria-label={listening ? 'Release to ask' : speaking ? 'Interrupt and speak' : 'Speak'}
              className={clsx(
                'flex h-12 w-12 items-center justify-center rounded-full border transition-all',
                listening && 'border-stamp bg-paperlight shadow-[var(--lift-shadow)]',
                thinking && 'border-stamp animate-pulse bg-paperlight',
                speaking && 'border-stamp bg-stamp shadow-[var(--lift-shadow)]',
                !listening && !thinking && !speaking && 'border-ink bg-paperlight',
              )}
            >
              {/* living waveform: three bars breathing while he listens/speaks */}
              <span className='flex items-end gap-[3px]' aria-hidden='true'>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={clsx(
                      'w-[3px] rounded-sm',
                      speaking ? 'bg-paperlight' : 'bg-stamp',
                      listening || speaking ? 'animate-pulse' : '',
                    )}
                    style={{
                      height: `${[10, 16, 7][i]}px`,
                      animationDelay: `${i * 180}ms`,
                      animationDuration: listening || speaking ? '900ms' : undefined,
                    }}
                  />
                ))}
              </span>
            </button>
          )}

          {/* text mode: the field replaces the transcript line */}
          {inputMode === 'text' && (
            <PaperField
              ref={inputRef}
              type='text'
              className='w-72 text-sm'
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
          )}

          {/* mic ⇄ keyboard toggle, in the orb itself */}
          {SR && (
            <button
              type='button'
              className='typed text-mutedink hover:text-ink text-[9px]'
              aria-label={inputMode === 'voice' ? 'Switch to typing' : 'Switch to voice'}
              onClick={() => {
                if (listening) stopListening(false);
                setMode(inputMode === 'voice' ? 'text' : 'voice');
              }}
            >
              {inputMode === 'voice' ? '⌨ TYPE' : '🎙 SPEAK'}
            </button>
          )}

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

      {/* the subtitle: one line at the bottom edge while he speaks.
          The lasting record is the margin note, not this caption. */}
      {speaking && answer && (
        <div className='pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-6'>
          <p
            className='text-ink max-w-2xl truncate text-center text-[13px] italic opacity-80'
            data-testid='prof-caption'
          >
            {lastLine(answer)}
          </p>
        </div>
      )}
      {error && (
        <div className='pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center'>
          <p className='typed text-[10px] text-stamp'>{error}</p>
        </div>
      )}
    </>
  );
};

export default ProfOverlay;
