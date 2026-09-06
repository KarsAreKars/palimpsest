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
import React, { useEffect, useRef, useState } from 'react';
import { useProfessor } from '@/app/reader/hooks/useProfessor';
import { stripAnnotations } from '@/services/professor/annotations';
import { PaperField } from '@/components/apothecary';
import ProfBlob from './ProfBlob';
import { getAIFetch } from '@/services/ai/utils/httpFetch';

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
    const saved = localStorage.getItem(INPUT_MODE_KEY);
    if (saved === 'voice' || saved === 'text') return saved;
    // Default is TEXT: the user dictates via TypeWhisper (system-level — it
    // owns the mic, the STT, and its own waveform UI) straight into the
    // field. In-app voice stays available via the SPEAK toggle.
    return 'text';
  } catch {
    return 'text';
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
  const [sttError, setSttError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const SR = typeof window !== 'undefined' ? getSpeechRecognition() : null;
  const canSR = !!SR;
  const canRecord =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;
  // WKWebView may lack BOTH SpeechRecognition and getUserMedia — never trap
  // the user in a voice mode that can't hear. Fall back to the text field.
  const voiceCapable = canSR || canRecord;

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
    const aiFetch = getAIFetch();
    console.info('[prof] stt: posting', blob.size, 'bytes');
    aiFetch(`${STT_BASE}/stt`, { method: 'POST', body: blob })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        const { text } = (await res.json()) as { text: string };
        console.info('[prof] stt heard:', text);
        const q = (text || fallback).trim();
        if (q) submit(q);
        else setSttError('DID NOT CATCH THAT — TRY AGAIN');
      })
      .catch((e) => {
        console.warn('[prof] stt failed:', e);
        const q = fallback.trim();
        if (q) submit(q);
        else setSttError('STT OFFLINE — TYPE INSTEAD');
      });
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setLiveStream(stream);
      console.info('[prof] mic stream live');
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start();
      recorderRef.current = rec;
    } catch (e) {
      console.warn('[prof] mic unavailable:', e);
      recorderRef.current = null; // mic denied — Web Speech still carries it
      if (!canSR) setSttError('NO MIC ACCESS — TYPE INSTEAD');
    }
  };

  const stopRecording = (submit: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) return;
    rec.onstop = () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLiveStream(null);
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
    if (!question || phase !== 'idle') {
      console.warn('[prof] submit blocked', { question, phase });
      return;
    }
    console.info('[prof] ask:', question);
    setSttError('');
    setDraft('');
    void ask(question);
  };

  const startListening = () => {
    if (listening || !voiceCapable) return;
    setSttError('');
    if (phase === 'answering' || phase === 'thinking') interrupt();
    void startRecording(); // Whisper's ear — the transcript authority
    if (!SR) {
      // No browser STT: Whisper-only mode (no ghost partials, still voice).
      setDraft('');
      setListening(true);
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
    if (inputMode === 'voice' && voiceCapable) {
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
  // ⌥Space while open: listening → release+ask; text with content → ask;
  // otherwise → close.
  useEffect(() => {
    const onRelease = () => {
      if (listening) stopListening(true);
      else if (draft.trim()) submit();
      else close();
    };
    window.addEventListener('prof-release', onRelease);
    return () => window.removeEventListener('prof-release', onRelease);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, draft]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  if (!open) return null;

  const speaking = phase === 'answering';
  const thinking = phase === 'thinking';
  // The mode actually rendered: chosen mode, downgraded to text when this
  // webview has no ear at all.
  const effectiveMode: InputMode = inputMode === 'voice' && voiceCapable ? 'voice' : 'text';

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
        {sttError && (
          <div className='typed text-stamp max-w-lg truncate text-[10px]'>{sttError}</div>
        )}

        <div className='pointer-events-auto flex items-center gap-3'>
          {/* the blob — audio-reactive, borrowed from ClickyX */}
          {effectiveMode === 'voice' && (
            <ProfBlob
              size={64}
              state={
                listening ? 'listening' : thinking ? 'thinking' : speaking ? 'speaking' : 'idle'
              }
              stream={liveStream}
              onClick={orbClick}
              label={
                listening ? 'Release to ask (⌥Space)' : speaking ? 'Interrupt and speak' : 'Speak'
              }
            />
          )}

          {/* text mode: the field replaces the transcript line */}
          {effectiveMode === 'text' && (
            <PaperField
              ref={inputRef}
              type='text'
              className='w-72 text-sm'
              placeholder='Ask — or dictate with TypeWhisper…'
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

          {/* mic ⇄ keyboard toggle, in the orb itself — ALWAYS rendered
              (gating it on SR once trapped WKWebView users in a dead voice
              mode with no way to type, 2026-09-06) */}
          <button
            type='button'
            className='typed text-mutedink hover:text-ink text-[9px]'
            aria-label={effectiveMode === 'voice' ? 'Switch to typing' : 'Switch to voice'}
            onClick={() => {
              if (listening) stopListening(false);
              setMode(effectiveMode === 'voice' ? 'text' : 'voice');
            }}
          >
            {effectiveMode === 'voice' ? '⌨ TYPE' : '🎙 SPEAK'}
          </button>

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
