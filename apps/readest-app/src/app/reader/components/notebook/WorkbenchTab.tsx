/**
 * WorkbenchTab — the notebook's fourth tab, Workbench 2.1: the block
 * transcript. A sitting, not a chat and not a desk of buttons:
 *
 *   THE PROFESSOR writes a block (Streamdown + KaTeX, protocol tags
 *   stripped before they ever reach the eye). YOU write a block
 *   underneath. Hairlines separate the blocks; the only chrome is the
 *   composer pinned at the bottom — and, in the never-used state only,
 *   one stamp button.
 *
 * Contracts consumed (owned by other lanes — do NOT edit them):
 *   - services/professor/workbenchSession.ts — startWorkbenchSession /
 *     sendWorkbenchTurn (streams tokens; rebuilds the tiered book pack
 *     every turn; the professor cites only the pack's page whitelist)
 *   - services/professor/professorTags.ts     — protocol tag parsing
 *   - services/professor/mathCheck.ts         — silent derivation checks
 *   - ./workbenchChat.ts (this lane)          — transcript store + helpers
 *
 * The mount contract (React.lazy + DeskErrorBoundary in Notebook.tsx) is
 * unchanged — a failure inside this subtree must never take the reader down.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import 'katex/dist/katex.min.css';
import { PiCaretDown } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { getDir } from '@/utils/book';
import { getNarration } from '@/services/narration/speakMode';
import {
  startWorkbenchSession,
  sendWorkbenchTurn,
  type WorkbenchBlock,
  type WorkbenchErrorKind,
} from '@/services/professor/workbenchSession';
import { checkDerivation } from '@/services/professor/mathCheck';
import { parseProfessorTags } from '@/services/professor/professorTags';
import { extractDiagramSvg } from '@/services/professor/diagramSvg';
import {
  WorkbenchVoicePlayer,
  type WorkbenchVoiceErrorKind,
  type WorkbenchVoiceState,
} from '@/services/professor/workbenchVoice';
import type { ProfessorSpeechSource } from '@/services/professor/voice';
import {
  WORKBENCH_TRANSCRIPT_FILENAME,
  MAX_STEPS_PER_CHECK,
  associateLearnerStep,
  commitProfessorBlock,
  derivationOrdinal,
  extractMathSteps,
  isProbeSignal,
  newBlockId,
  parseTranscript,
  serializeTranscript,
  stripPartialTagTail,
  summarizeChecks,
  useWorkbenchChatStore,
  type BlockCheck,
  type ConceptMapData,
  type ProbeStance,
  type TranscriptBlock,
} from './workbenchChat';
import { Prose, Slip, VerdictChip } from './wbShared';
import DerivationSlip from './DerivationSlip';
import DiagramSlip from './DiagramSlip';
import './WorkbenchTab.css';

// MathLive touches `window` at definition time — the hard next/dynamic
// ssr:false rule (2026-09-06). The popover mounts it lazily on first open.
const MathField = dynamic(() => import('./MathField'), { ssr: false });

const toText = (c: string | ArrayBuffer): string =>
  typeof c === 'string' ? c : new TextDecoder().decode(c);

const EMPTY_BLOCKS: TranscriptBlock[] = [];
const EMPTY_CHECKS: Record<string, BlockCheck> = {};

/** Follow distance: within 24px of the bottom the scroll stays pinned. */
const PIN_THRESHOLD_PX = 24;
/** The professor-block placeholder mounts only after this long in flight,
 *  so a fast first token never flickers a placeholder. */
const PLACEHOLDER_DELAY_MS = 400;
/** After this long with no tokens, the patience line fades in. */
const THINKING_DELAY_MS = 3000;
/** The silent check may hold the professor's reply at most this long. */
const CHECK_BUDGET_MS = 2500;

const NO_KEY_PATTERN = /No AI provider configured|provider is not configured/i;

/** True when the reader asked the motion to stop — glides collapse to
 *  instant jumps (§12). */
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A cheap content hash for silent-check skipping: only blocks whose text
 *  changed since their last check are re-submitted (never the quadratic
 *  whole-transcript re-check). */
const contentHash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
};

// ---------------------------------------------------------------------------
// Small presentational pieces (the shared layer lives in wbShared.tsx —
// audit R5; Prose/Slip/VerdictChip are re-imported therefrom unchanged)
// ---------------------------------------------------------------------------

/** Split display markdown on the professor's `[Page N]` citations: the
 *  anchors become chips (evidence you can travel to), the rest stays prose. */
const splitPageCites = (text: string): { text?: string; page?: number }[] => {
  const out: { text?: string; page?: number }[] = [];
  const re = /\[Page (\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ page: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
};

/** The silent checker's verdicts, rendered inside the student block. No
 *  verdict and no chip for plain prose; `unavailable` renders nothing at
 *  all (echo mode — no marks, no blame). */
const BlockChips: React.FC<{ check?: BlockCheck }> = ({ check }) => {
  const _ = useTranslation();
  if (!check || check.status === 'unavailable') return null;
  if (check.status === 'checking') {
    return (
      <div className='wb-chip-row'>
        <span className='wb-chip wb-chip-muted' role='img' aria-label={_('Checking')}>
          {_('CHECKING…')}
          <span className='wb-dots' aria-hidden='true'>
            <i />
            <i />
            <i />
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className='wb-chip-row'>
      {check.verdicts.map((v) => (
        <VerdictChip key={v.id} verdict={v} />
      ))}
    </div>
  );
};

const NoKeyGuidance: React.FC<{ _: TranslationFunc; onOpen: () => void }> = ({ _, onOpen }) => (
  <div className='wb-nokey plate'>
    <p className='wb-nokey-body'>{_('The professor needs a connection before he can sit down.')}</p>
    <p className='wb-nokey-hint'>{_('Connect one in Settings → Integrations.')}</p>
    <button type='button' className='stamp-btn' onClick={onOpen}>
      {_('Open integrations')}
    </button>
  </div>
);

const PageChip: React.FC<{ page: number; quote: string | null; onGo: () => void }> = ({
  page,
  quote,
  onGo,
}) => {
  const _ = useTranslation();
  return (
    <button
      type='button'
      className='wb-chip wb-page-chip'
      aria-label={_('P. {{page}}', { page })}
      onClick={onGo}
    >
      {_('P. {{page}}', { page })}
      {quote && <Slip label={_('From the page')}>{quote}</Slip>}
    </button>
  );
};

const STANCES: { stance: ProbeStance; label: string }[] = [
  { stance: 'lead', label: 'Lead me' },
  { stance: 'ask', label: 'Ask me first' },
  { stance: 'work', label: 'I will work it' },
];

/** The stance chip row under a [PROBE] block (s1 §5.2) — the sanctioned
 *  mid-session interaction: the chips replace a typed message and go inert
 *  after a pick. */
const ProbeRow: React.FC<{
  picked?: ProbeStance;
  onPick: (stance: ProbeStance, message: string) => void;
}> = ({ picked, onPick }) => {
  const _ = useTranslation();
  return (
    <div
      className='wb-probe-row'
      role='group'
      aria-label={_('Choose how the professor guides you')}
    >
      {STANCES.map(({ stance, label }) => (
        <button
          key={stance}
          type='button'
          className={`wb-chip wb-probe-chip${picked === stance ? ' wb-probe-picked' : ''}`}
          disabled={picked !== undefined}
          onClick={() => onPick(stance, _(label))}
        >
          {_(label)}
          {picked === stance && (
            <span className='wb-probe-tick' aria-hidden='true'>
              {_('Chosen')}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

/** The concept-map slip (s1 §5.2) — the session's known/edge/unknown
 *  catalogue; every chip travels to the thread where the concept was last
 *  discussed. Names never yet discussed render as muted, inert chips. */
const ConceptMapSlip: React.FC<{
  map: ConceptMapData;
  onOpen: (threadId: string) => void;
}> = ({ map, onOpen }) => {
  const _ = useTranslation();
  const shelves: { head: string; entries: ConceptMapData['known'] }[] = [
    { head: _('KNOWN'), entries: map.known },
    { head: _('EDGE'), entries: map.edge },
    { head: _('UNKNOWN'), entries: map.unknown },
  ];
  return (
    <div className='wb-map'>
      <p className='wb-map-caption'>{_('The catalogue so far')}</p>
      <div className='wb-map-cols'>
        {shelves.map(({ head, entries }) => (
          <div className='wb-map-col' key={head}>
            <span className='wb-map-head'>{head}</span>
            {entries.length === 0 && (
              <span className='wb-map-empty'>{_('Nothing filed here yet')}</span>
            )}
            {entries.map((entry) =>
              entry.threadId ? (
                <button
                  key={entry.name}
                  type='button'
                  className='wb-chip wb-map-chip'
                  aria-label={_('Open the thread on {{concept}}', { concept: entry.name })}
                  onClick={() => onOpen(entry.threadId!)}
                >
                  {entry.name}
                </button>
              ) : (
                <span key={entry.name} className='wb-chip wb-map-chip wb-map-chip-dim'>
                  {entry.name}
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/** The "consulting the book" mark under a block whose professor consulted
 *  pages via [LOOK] (s2 §8 — landed with wave A per audit R7a). */
const ConsultMark: React.FC<{ pages: number[] }> = ({ pages }) => {
  const _ = useTranslation();
  return (
    <p className='wb-consult' role='status'>
      <span className='wb-consult-mark' aria-hidden='true'>
        ❧
      </span>
      {pages.length > 0
        ? _('Consulted page {{pages}}', { pages: pages.join(', ') })
        : _('The book had nothing on that page.')}
    </p>
  );
};

/** The read-aloud control under a PROFESSOR block only (asymmetric voice —
 *  learner blocks never speak, s4 §6). A [VOICE]-tagged block renders the
 *  control promoted, in the stamp accent, with the professor's slip. The
 *  control is a real button reached by Tab like every other control — no
 *  global shortcuts, no mid-session buttons. */
const VoiceControl: React.FC<{
  block: TranscriptBlock;
  playerState: WorkbenchVoiceState;
  notice: WorkbenchVoiceErrorKind | null;
  speaking: boolean;
  onSpeak: () => void;
  onPause: () => void;
  onResume: () => void;
  onReplay: () => void;
  onDismissNotice: () => void;
}> = ({
  block,
  playerState,
  notice,
  speaking,
  onSpeak,
  onPause,
  onResume,
  onReplay,
  onDismissNotice,
}) => {
  const _ = useTranslation();
  const promoted = Boolean(block.voice?.requested);
  const heard = Boolean(block.voice?.lastHeardAt);
  const btnClass = `wb-chip wb-voice-btn${promoted ? ' wb-voice-promoted' : ''}`;
  return (
    <div className='wb-voice'>
      {speaking && playerState === 'synthesizing' && (
        <span className='wb-chip wb-voice-speaking' role='status'>
          {_('Speaking…')}
          <span className='wb-dots' aria-hidden='true'>
            <i />
            <i />
            <i />
          </span>
        </span>
      )}
      {speaking && playerState === 'playing' && (
        <button
          type='button'
          className='wb-chip wb-voice-btn wb-voice-speaking'
          aria-pressed='true'
          onClick={onPause}
        >
          {_('Pause reading')}
        </button>
      )}
      {speaking && playerState === 'paused' && (
        <button
          type='button'
          className='wb-chip wb-voice-btn'
          aria-pressed='false'
          onClick={onResume}
        >
          {_('Resume reading')}
        </button>
      )}
      {!speaking && (
        <>
          <button type='button' className={btnClass} onClick={onSpeak}>
            {_('Read this aloud')}
            {promoted && <Slip>{_('The professor asks that this be heard.')}</Slip>}
          </button>
          {heard && (
            <button
              type='button'
              className='wb-chip wb-voice-btn wb-voice-muted'
              onClick={onReplay}
            >
              {_('Read again')}
            </button>
          )}
        </>
      )}
      {notice && (
        <p className='wb-voice-notice' role='note'>
          {notice === 'voice-busy' &&
            _('The book is still reading aloud. The desk waits its turn.')}
          {notice === 'voice-unavailable' && _('The reading voice is away.')}
          {notice === 'voice-failed' && _("The professor's voice faltered. Nothing was lost.")}
          {notice === 'voice-busy' && (
            <button type='button' className='ink-btn' onClick={onDismissNotice}>
              {_('Dismiss')}
            </button>
          )}
          {notice === 'voice-failed' && (
            <button type='button' className='ink-btn' onClick={onSpeak}>
              {_('Try again')}
            </button>
          )}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

const WorkbenchTab: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const aiSettings = useSettingsStore((s) => s.settings.aiSettings);
  const safeAreaInsets = useThemeStore((s) => s.safeAreaInsets);
  const blocks = useWorkbenchChatStore((s) => s.blocks[bookKey]) ?? EMPTY_BLOCKS;
  const checks = useWorkbenchChatStore((s) => s.checks[bookKey]) ?? EMPTY_CHECKS;
  const setBlocks = useWorkbenchChatStore((s) => s.setBlocks);
  const appendBlock = useWorkbenchChatStore((s) => s.appendBlock);
  const setCheck = useWorkbenchChatStore((s) => s.setCheck);
  const markProbePicked = useWorkbenchChatStore((s) => s.markProbePicked);
  const updateBlock = useWorkbenchChatStore((s) => s.updateBlock);

  const hasKey =
    Boolean(aiSettings?.enabled) &&
    (aiSettings?.provider === 'ollama' ||
      (aiSettings?.provider === 'ai-gateway'
        ? Boolean(aiSettings.aiGatewayApiKey)
        : Boolean(aiSettings?.openrouterApiKey)));

  // ── Voice answers (s4): one player per tab; narration owns audio focus ──
  const voiceRef = useRef<WorkbenchVoicePlayer | null>(null);
  const [voiceState, setVoiceState] = useState<WorkbenchVoiceState>('idle');
  const [voiceActiveId, setVoiceActiveId] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<{
    blockId: string | null;
    kind: WorkbenchVoiceErrorKind;
  } | null>(null);

  const getVoicePlayer = useCallback((): WorkbenchVoicePlayer => {
    voiceRef.current ??= new WorkbenchVoicePlayer({
      // HP-3: voice id + rate resolve from the narration controller's
      // speech identity, read live — no new settings.
      getSpeech: () => getNarration(bookKey)?.controller?.speech ?? null,
      isNarrationActive: () => getNarration(bookKey)?.controller?.active ?? false,
      onState: (s) => {
        setVoiceState(s);
        setVoiceActiveId(voiceRef.current?.activeBlockId ?? null);
      },
      onError: (kind) => setVoiceNotice({ blockId: voiceRef.current?.activeBlockId ?? null, kind }),
    });
    return voiceRef.current;
  }, [bookKey]);

  /** A natural completion writes which voice spoke back into the block, so
   *  a restored sitting remembers (s4 §4.4 — metadata only, never audio). */
  const recordHeard = useCallback(
    (block: TranscriptBlock, speech: ProfessorSpeechSource | null) => {
      if (!speech) return;
      updateBlock(bookKey, block.id, {
        voice: {
          requested: block.voice?.requested ?? false,
          voiceId: speech.voice,
          lastHeardAt: new Date().toISOString(),
        },
      });
    },
    [bookKey, updateBlock],
  );

  const handleVoiceSpeak = useCallback(
    (block: TranscriptBlock) => {
      setVoiceNotice(null);
      void getVoicePlayer()
        .speak(block.id, block.content)
        .then((speech) => recordHeard(block, speech));
    },
    [getVoicePlayer, recordHeard],
  );

  const handleVoiceReplay = useCallback(
    (block: TranscriptBlock) => {
      setVoiceNotice(null);
      void getVoicePlayer()
        .replay(block.id)
        .then((speech) => recordHeard(block, speech));
    },
    [getVoicePlayer, recordHeard],
  );

  // Focus law (s4 §5): the narration controller owns audio focus. When it
  // takes focus (unit-change fires at every playFrom), workbench playback
  // yields instantly. A narration session that appears later (the reader
  // opened the book after the tab) un-mutes the controls via reset().
  useEffect(() => {
    const controller = getNarration(bookKey)?.controller;
    if (!controller) return;
    if (voiceRef.current?.state === 'unavailable') voiceRef.current.reset();
    const onUnitChange = () => voiceRef.current?.stop();
    controller.addEventListener('unit-change', onUnitChange);
    return () => controller.removeEventListener('unit-change', onUnitChange);
  }, [blocks, bookKey]);

  const openIntegrations = useCallback(() => {
    useSettingsStore.getState().setRequestedPanel('Integrations');
    useSettingsStore.getState().setSettingsDialogOpen(true);
  }, []);

  // ── Streaming machinery (component-local; never leaves this subtree) ───
  const [phase, setPhase] = useState<'idle' | 'awaiting' | 'streaming'>('idle');
  const [partial, setPartial] = useState('');
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<{
    kind: WorkbenchErrorKind;
    retry: (() => void) | null;
  } | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const partialRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);
  const delayTimersRef = useRef<number[]>([]);

  const clearDelayTimers = useCallback(() => {
    delayTimersRef.current.forEach((t) => window.clearTimeout(t));
    delayTimersRef.current = [];
  }, []);

  /** Tears down any in-flight request and arms a fresh generation. */
  const beginStream = useCallback(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++genRef.current;
    clearDelayTimers();
    partialRef.current = '';
    setPartial('');
    setShowPlaceholder(false);
    setThinking(false);
    setPhase('awaiting');
    delayTimersRef.current.push(
      window.setTimeout(() => {
        if (genRef.current === gen && partialRef.current === '') setShowPlaceholder(true);
      }, PLACEHOLDER_DELAY_MS),
      window.setTimeout(() => {
        if (genRef.current === gen && partialRef.current === '') setThinking(true);
      }, THINKING_DELAY_MS),
    );
    return gen;
  }, [clearDelayTimers]);

  const streamCallbacks = useCallback(
    (
      gen: number,
      onFull: (full: string) => void,
    ): Parameters<typeof sendWorkbenchTurn>[0]['cb'] => ({
      onToken: (token: string) => {
        if (genRef.current !== gen) return;
        partialRef.current += token;
        setPartial(partialRef.current);
        setPhase('streaming');
        setShowPlaceholder(true);
        setThinking(false);
      },
      onDone: (full: string) => {
        if (genRef.current !== gen) return;
        clearDelayTimers();
        partialRef.current = '';
        setPartial('');
        setShowPlaceholder(false);
        setThinking(false);
        setPhase('idle');
        setError(null);
        if (full.trim()) onFull(full);
      },
      onError: (message: string, kind?: WorkbenchErrorKind) => {
        if (genRef.current !== gen) return;
        clearDelayTimers();
        // Honest paper: whatever the professor managed to write stays.
        const written = partialRef.current;
        if (written.trim()) {
          appendBlock(
            bookKey,
            commitProfessorBlock(written, useWorkbenchChatStore.getState().blocks[bookKey] ?? []),
          );
        }
        partialRef.current = '';
        setPartial('');
        setShowPlaceholder(false);
        setThinking(false);
        setPhase('idle');
        // The raw provider message is debug-only; the kind picks fixed copy.
        const resolved: WorkbenchErrorKind =
          kind ?? (NO_KEY_PATTERN.test(message) ? 'no-provider' : 'unknown');
        setError({ kind: resolved, retry: retryRef.current });
      },
    }),
    [bookKey, appendBlock, clearDelayTimers],
  );

  /** If the student speaks mid-stream, the professor's partial block is
   *  committed as-is (a sitting is honest paper) before the turn changes. */
  const commitPartialIfAny = useCallback(() => {
    const written = partialRef.current;
    if (!written.trim()) return;
    appendBlock(
      bookKey,
      commitProfessorBlock(written, useWorkbenchChatStore.getState().blocks[bookKey] ?? []),
    );
    partialRef.current = '';
    setPartial('');
  }, [bookKey, appendBlock]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      clearDelayTimers();
      // A new sitting gesture silences the old voice; so does leaving.
      voiceRef.current?.stop();
    },
    [clearDelayTimers],
  );

  // ── Session bootstrap ──────────────────────────────────────────────────
  const startSession = useCallback(() => {
    const existing = useWorkbenchChatStore.getState().blocks[bookKey] ?? [];
    setError(null);
    retryRef.current = () => startSession();
    const gen = beginStream();
    void startWorkbenchSession({
      bookKey,
      resumeBlocks: existing as WorkbenchBlock[],
      aiSettings,
      signal: abortRef.current?.signal,
      cb: streamCallbacks(gen, (full) =>
        appendBlock(bookKey, commitProfessorBlock(full, existing)),
      ),
    });
  }, [bookKey, aiSettings, beginStream, streamCallbacks, appendBlock]);

  // ── Silent checking (§6.5 — no check button; it just happens) ──────────
  const checkInFlightRef = useRef(false);
  const checkAgainRef = useRef(false);
  /** blockId → content hash at last successful check. Blocks whose text is
   *  unchanged are never re-submitted; echo mode records nothing so a later
   *  turn quietly retries instead of skipping. */
  const checkedHashRef = useRef(new Map<string, string>());

  const runSilentCheck = useCallback(
    async (candidates: TranscriptBlock[]): Promise<void> => {
      const withMath = candidates.filter((b) => {
        // "I don't know" is a first-class signal — surfaced, never graded (s1).
        if (b.probeSignal) return false;
        // The professor's folios are marked too — the desk does not grade
        // only the learner's paper (s3 §4.1).
        if (b.derivation && b.derivation.steps.length > 0) return true;
        return b.author === 'user' && extractMathSteps(b.content, b.id).length > 0;
      });
      if (withMath.length === 0) return;
      if (checkInFlightRef.current) {
        // One check at a time; queue a re-run against the newest blocks.
        checkAgainRef.current = true;
        return;
      }
      checkInFlightRef.current = true;
      const alive = (id: string) =>
        (useWorkbenchChatStore.getState().blocks[bookKey] ?? []).some((b) => b.id === id);
      // Only blocks whose checkable content changed since their last check —
      // each block's chain is judged WITHIN itself, never against a neighbour
      // block (the old flatMap compared block A's last step with block B's
      // first and manufactured ✗s). For folios the fingerprint covers the
      // STEPS (the block's prose does not change when the learner appends
      // a step) plus the goal.
      const stale = withMath
        .map((b) => ({
          block: b,
          fingerprint:
            b.derivation && b.derivation.steps.length > 0
              ? `folio:${JSON.stringify(b.derivation.steps)}|${b.derivation.goalLatex ?? ''}`
              : contentHash(b.content),
        }))
        .filter(({ block, fingerprint }) => checkedHashRef.current.get(block.id) !== fingerprint);
      try {
        if (stale.length === 0) return; // nothing new — the last marks stand
        stale.forEach(({ block }) => {
          if (alive(block.id)) setCheck(bookKey, block.id, { status: 'checking' });
        });
        const results = await Promise.all(
          stale.map(async ({ block, fingerprint }) => {
            // Folios submit their structured steps (prefix-sliced to the same
            // MAX_STEPS_PER_CHECK cap: step 9+ simply wears no chip);
            // ordinary blocks go through the usual extraction.
            const steps =
              block.derivation && block.derivation.steps.length > 0
                ? block.derivation.steps
                    .slice(0, MAX_STEPS_PER_CHECK)
                    .map(({ id, latex }) => ({ id, latex }))
                : extractMathSteps(block.content, block.id);
            const result = await checkDerivation(steps, block.derivation?.goalLatex);
            return { block, steps, result, fingerprint };
          }),
        );
        for (const { block, steps, result, fingerprint } of results) {
          if (!alive(block.id)) continue;
          if (result.unavailable) {
            // Echo mode: the engine is away — no marks, and no hash is
            // recorded so the next turn quietly retries.
            setCheck(bookKey, block.id, { status: 'unavailable' });
            continue;
          }
          const byId = new Map(result.steps.map((v) => [v.id, v]));
          setCheck(bookKey, block.id, {
            status: 'done',
            verdicts: steps.map(
              (s, i) => byId.get(s.id) ?? { id: `${block.id}:${i}`, status: 'ok' },
            ),
            ...(result.goal ? { goal: result.goal } : {}),
          });
          // Persist the whole-derivation verdict onto the block so a resumed
          // sitting keeps it (the transcript saves on every blocks change).
          if (result.goal && block.derivation) {
            const cur = useWorkbenchChatStore.getState().blocks[bookKey] ?? [];
            if (cur.some((b) => b.id === block.id)) {
              setBlocks(
                bookKey,
                cur.map((b) =>
                  b.id === block.id && b.derivation
                    ? {
                        ...b,
                        derivation: {
                          ...b.derivation,
                          goalReached: result.goal!.reached,
                          ...(result.goal!.byStep ? { goalByStep: result.goal!.byStep } : {}),
                        },
                      }
                    : b,
                ),
              );
            }
          }
          checkedHashRef.current.set(block.id, fingerprint);
        }
      } catch {
        stale.forEach(({ block }) => {
          if (alive(block.id)) setCheck(bookKey, block.id, null);
        });
      } finally {
        checkInFlightRef.current = false;
        if (checkAgainRef.current) {
          checkAgainRef.current = false;
          const latest = useWorkbenchChatStore.getState().blocks[bookKey] ?? [];
          await runSilentCheck(latest);
        }
      }
    },
    [bookKey, setCheck, setBlocks],
  );

  // ── One turn: silent check, then the professor answers ─────────────────
  const respond = useCallback(
    async (history: TranscriptBlock[], userContent: string) => {
      retryRef.current = () => void respond(history, userContent);
      setError(null);
      // The professor reads the deterministic verdict summary before
      // answering — but the checker never gets to delay him long (§6.5:
      // never interrupt).
      const checkPromise = runSilentCheck(history);
      await Promise.race([
        checkPromise,
        new Promise((resolve) => setTimeout(resolve, CHECK_BUDGET_MS)),
      ]);
      const checksMap = useWorkbenchChatStore.getState().checks[bookKey] ?? {};
      const summary = summarizeChecks(
        history
          .filter((b) => b.author === 'user')
          .map((b) => checksMap[b.id])
          .filter((c): c is BlockCheck => Boolean(c)),
      );
      const gen = beginStream();
      sendWorkbenchTurn({
        bookKey,
        history: history as WorkbenchBlock[],
        userContent,
        checkerSummary: summary ?? undefined,
        aiSettings,
        signal: abortRef.current?.signal,
        cb: streamCallbacks(gen, (full) =>
          appendBlock(bookKey, commitProfessorBlock(full, history)),
        ),
      });
    },
    [bookKey, aiSettings, beginStream, streamCallbacks, appendBlock, runSilentCheck],
  );

  // ── The composer ───────────────────────────────────────────────────────
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const send = useCallback(
    (override?: string) => {
      // Stop-on-new-turn (s4 §5 law 3): the FIRST statement — a probe-chip
      // pick rides send() too, so it inherits silence (audit Risk 5).
      voiceRef.current?.stop();
      const text = (override ?? value).trim();
      if (!text) return; // a quiet no-op — no disabled state, no error
      if (phaseRef.current !== 'idle') commitPartialIfAny();
      const priorBlocks = useWorkbenchChatStore.getState().blocks[bookKey] ?? [];
      const userBlock: TranscriptBlock = {
        id: newBlockId(),
        author: 'user',
        content: text,
        at: new Date().toISOString(),
      };
      // Teach-back: this attempt answers the professor's open ask (s1 §5.2).
      const prior = priorBlocks[priorBlocks.length - 1];
      if (prior?.author === 'professor' && prior.teachbackAsk && !prior.teachbackOf) {
        userBlock.teachbackAsk = prior.teachbackAsk;
      }
      // "I don't know" is surfaced as a marker chip — never graded (s1).
      if (isProbeSignal(text)) userBlock.probeSignal = true;
      // A step/justify-only block appends to the professor's open folio;
      // the learner's paper still lands as their own block (s3 §7.3).
      const associated = associateLearnerStep(priorBlocks, userBlock);
      if (associated !== priorBlocks) {
        const changed = associated.find((b, i) => b !== priorBlocks[i]);
        if (changed) userBlock.extendsDerivation = changed.id;
        setBlocks(bookKey, associated);
      }
      appendBlock(bookKey, userBlock);
      setValue('');
      textareaRef.current?.focus();
      const history = [...(useWorkbenchChatStore.getState().blocks[bookKey] ?? [])];
      void respond(history, userBlock.content);
    },
    [value, bookKey, appendBlock, respond, commitPartialIfAny, setBlocks],
  );

  /** The probe chip pick is an ordinary student message through send() —
   *  partial-commit, silent-check, and history all behave identically to a
   *  typed message (s1 §5.2). */
  const pickProbe = useCallback(
    (blockId: string, stance: ProbeStance, message: string) => {
      markProbePicked(bookKey, blockId, stance);
      send(message);
    },
    [bookKey, markProbePicked, send],
  );

  const handleComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline. ⌘/Ctrl+Enter also sends.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const composerRows = Math.min(5, Math.max(1, value.split('\n').length));

  // ── The ƒx popover (MathLive composer) ─────────────────────────────────
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

  // A folio is open while the last professor block carries a derivation —
  // only a later professor prose block closes it (s3 §7.3, §10 Q2).
  const folioOpen = Boolean(
    [...blocks].reverse().find((b) => b.author === 'professor')?.derivation,
  );

  /** Splice a snippet into the textarea at the caret (shared by the single
   *  expression insert and the step/justify pair commit — s3 §7.3). */
  const spliceAtCaret = useCallback(
    (snippet: string) => {
      const ta = textareaRef.current;
      const start = ta?.selectionStart ?? value.length;
      const end = ta?.selectionEnd ?? value.length;
      setValue(value.slice(0, start) + snippet + value.slice(end));
      const caret = start + snippet.length;
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(caret, caret);
      });
    },
    [value],
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

  // ── Persistence: a per-book transcript document (AppService file API,
  //    the desk's pattern — failure is a console.warn, never a throw) ─────
  const loadedRef = useRef(false);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadedRef.current = false;
    void (async () => {
      try {
        const book = getBookData(bookKey)?.book;
        if (appService && book) {
          const raw = await appService.readFile(
            `${getDir(book)}/${WORKBENCH_TRANSCRIPT_FILENAME}`,
            'Books',
            'text',
          );
          const parsed = parseTranscript(toText(raw));
          if (alive && parsed) {
            setBlocks(bookKey, parsed);
            if (parsed.length > 0) {
              // A restored sitting greets you once, quietly, per mount.
              setResumeNotice(getBookData(bookKey)?.book?.title ?? '');
            }
          }
        }
      } catch {
        // No saved sitting yet — a fresh sheet of paper is fine.
      } finally {
        if (alive) loadedRef.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookKey, appService, getBookData, setBlocks]);

  useEffect(() => {
    if (!loadedRef.current) return;
    void (async () => {
      try {
        const book = getBookData(bookKey)?.book;
        if (!appService || !book) return;
        await appService.writeFile(
          `${getDir(book)}/${WORKBENCH_TRANSCRIPT_FILENAME}`,
          'Books',
          serializeTranscript(blocks),
        );
      } catch (e) {
        // 4c: persistence failure is a warn — the sitting continues in memory.
        console.warn('[workbench] transcript persist failed', e);
      }
    })();
  }, [blocks, bookKey, appService, getBookData]);

  // ── Scroll policy (§8): pinned follow, no yank, one quiet stamp chip ───
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const committedCountRef = useRef(0);
  const [pinned, setPinned] = useState(true);
  const [growth, setGrowth] = useState(false);

  const atBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD_PX;
  }, []);

  // ── Width-drag re-anchoring (§11): across a panel resize, the first
  //    fully-visible block keeps its offset from the top of the viewport.
  //    The anchor is refreshed on every scroll so it is pre-computed before
  //    the ResizeObserver fires (it only notifies after reflow).
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);

  const refreshAnchor = useCallback(() => {
    const el = scrollRef.current;
    if (!el || pinnedRef.current) return;
    const articles = el.querySelectorAll<HTMLElement>('article[data-bid]');
    for (const a of articles) {
      // First block whose top edge is at or below the viewport top.
      if (a.offsetTop >= el.scrollTop - 1) {
        anchorRef.current = { id: a.dataset['bid'] ?? '', offset: a.offsetTop - el.scrollTop };
        return;
      }
    }
    anchorRef.current = null;
  }, []);

  const handleScroll = useCallback(() => {
    if (atBottom()) {
      if (!pinnedRef.current) {
        pinnedRef.current = true;
        setPinned(true);
        setGrowth(false);
      }
    } else if (pinnedRef.current) {
      // Scrolled up: unpin immediately and permanently — no yank.
      pinnedRef.current = false;
      setPinned(false);
      setGrowth(false);
    }
    refreshAnchor();
  }, [atBottom, refreshAnchor]);

  const scrollToBottomAndRepin = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    pinnedRef.current = true;
    setPinned(true);
    setGrowth(false);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width === lastWidth) return; // height-only growth: nothing to do
      lastWidth = width;
      const anchor = anchorRef.current;
      if (!anchor || pinnedRef.current) return; // pinned follow owns the tail
      const target = el.querySelector<HTMLElement>(`article[data-bid="${anchor.id}"]`);
      if (!target) return;
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = Math.min(Math.max(target.offsetTop - anchor.offset, 0), Math.max(max, 0));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [bookKey]);

  // Mount/resume: the sitting rests at the bottom, pinned.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    committedCountRef.current = (useWorkbenchChatStore.getState().blocks[bookKey] ?? []).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      const newBlocks = blocks.length !== committedCountRef.current;
      if (newBlocks) {
        // A whole new block: one smooth glide (instant under reduced motion).
        committedCountRef.current = blocks.length;
        el.scrollTo({
          top: el.scrollHeight,
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
      } else {
        // Streaming tokens / resolving chips: instant follow.
        el.scrollTop = el.scrollHeight;
      }
    } else {
      setGrowth(true); // unpinned, and the paper grew — offer the way back
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, checks, partial]);

  // ── Page chips: evidence you can travel to (thread 2, resolved — the
  //    click scrolls the book through the reader view's existing goTo) ────
  const quoteForPage = useCallback(
    (page: number): string | null => {
      try {
        const controller = getNarration(bookKey)?.controller;
        const md = controller?.md;
        const manifest = controller?.manifest;
        const span = manifest?.alignment?.find((a) => a.page === page);
        if (
          !md ||
          !span ||
          typeof span.md_char_start !== 'number' ||
          typeof span.md_char_end !== 'number'
        ) {
          return null;
        }
        const quote = md.slice(span.md_char_start, span.md_char_end).replace(/\s+/g, ' ').trim();
        if (!quote) return null;
        return quote.length > 260 ? `${quote.slice(0, 260)}…` : quote;
      } catch {
        return null;
      }
    },
    [bookKey],
  );

  const goToPage = useCallback(
    (page: number) => {
      try {
        void Promise.resolve(
          useReaderStore
            .getState()
            .getView(bookKey)
            ?.goTo?.(page - 1),
        ).catch(() => undefined);
      } catch {
        // The book view is not on screen — the chip is evidence, not a gate.
      }
    },
    [bookKey],
  );

  /** Concept chips travel the transcript: glide to the thread where the
   *  concept was last discussed (s1 §5.2). */
  const scrollToBlock = useCallback((id: string) => {
    const target = scrollRef.current?.querySelector(`article[data-bid="${id}"]`);
    target?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
  }, []);

  const renderContent = (text: string) =>
    splitPageCites(text).map((seg, i) => {
      if (seg.page !== undefined) {
        const page = seg.page;
        return (
          <PageChip key={i} page={page} quote={quoteForPage(page)} onGo={() => goToPage(page)} />
        );
      }
      return seg.text?.trim() ? <Prose key={i} text={seg.text} /> : null;
    });

  // ── Render ─────────────────────────────────────────────────────────────
  const sessionActive = blocks.length > 0 || phase !== 'idle';
  const showScrollChip = !pinned && growth;

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1'>
        <div className='wb-stage'>
          <div
            className='wb-transcript'
            ref={scrollRef}
            onScroll={handleScroll}
            role='log'
            aria-live='polite'
            aria-relevant='additions'
          >
            {resumeNotice && (
              <div className='wb-resume'>
                <span className='ornament' aria-hidden='true'>
                  ✳ ✳ ✳
                </span>
                <p className='wb-resume-text'>
                  {_('Resumed your sitting with {{book}}', { book: resumeNotice })}
                </p>
                <span className='ornament' aria-hidden='true'>
                  ✳ ✳ ✳
                </span>
              </div>
            )}

            {blocks.map((b, i) => (
              <article
                className={`wb-block${i === 0 && !resumeNotice ? ' wb-block-first' : ''}`}
                key={b.id}
                data-bid={b.id}
              >
                <p className='wb-byline'>{_(b.author === 'professor' ? 'THE PROFESSOR' : 'YOU')}</p>
                <div className='wb-content'>{renderContent(b.content)}</div>
                {b.author === 'professor' && (
                  <VoiceControl
                    block={b}
                    playerState={voiceState}
                    notice={voiceNotice?.blockId === b.id ? voiceNotice.kind : null}
                    speaking={voiceActiveId === b.id}
                    onSpeak={() => handleVoiceSpeak(b)}
                    onPause={() => voiceRef.current?.pause()}
                    onResume={() => voiceRef.current?.resume()}
                    onReplay={() => handleVoiceReplay(b)}
                    onDismissNotice={() => setVoiceNotice(null)}
                  />
                )}
                {b.author === 'professor' && b.conceptMap && (
                  <ConceptMapSlip map={b.conceptMap} onOpen={scrollToBlock} />
                )}
                {b.author === 'professor' && b.lookedUp && <ConsultMark pages={b.lookedUp} />}
                {b.author === 'professor' && b.probe && (
                  <ProbeRow picked={b.probePicked} onPick={(s, m) => pickProbe(b.id, s, m)} />
                )}
                {b.diagram && <DiagramSlip block={b} />}
                {b.author === 'professor' && b.derivation && b.derivation.steps.length > 0 && (
                  <DerivationSlip
                    block={b}
                    ordinalBase={derivationOrdinal(blocks, b.id, 0) - 1}
                    check={checks[b.id]}
                  />
                )}
                {b.author === 'user' &&
                  b.extendsDerivation &&
                  (() => {
                    const folio = blocks.find((f) => f.id === b.extendsDerivation);
                    if (!folio?.derivation) return null;
                    const stepCount = folio.derivation.steps.length;
                    const learnerStepCount = (b.content.match(/\$\$[\s\S]*?\$\$/g) ?? []).length;
                    if (learnerStepCount === 0 || learnerStepCount > stepCount) return null;
                    // The folio already carries these steps (associate-
                    // LearnerStep appended them); render the learner's paper
                    // compactly with the folio's own step ids and ordinals.
                    const base =
                      derivationOrdinal(blocks, folio.id, 0) - 1 + stepCount - learnerStepCount;
                    const learnerBlock: TranscriptBlock = {
                      ...b,
                      derivation: {
                        steps: folio.derivation.steps.slice(stepCount - learnerStepCount),
                      },
                    };
                    return (
                      <DerivationSlip
                        compact
                        block={learnerBlock}
                        ordinalBase={base}
                        check={checks[folio.id]}
                      />
                    );
                  })()}
                {b.author === 'user' && b.teachbackAsk && (
                  <p className='wb-teachback-caption'>
                    {_('The professor asked you to restate it — in your own words')}
                    <span className='wb-teachback-ask'>
                      {_('His question: {{ask}}', { ask: b.teachbackAsk })}
                    </span>
                  </p>
                )}
                {b.author === 'professor' && b.teachbackOf && (
                  <p className='wb-teachback-caption'>{_('His reading of your restatement')}</p>
                )}
                {b.author === 'user' && b.probeSignal && (
                  <div className='wb-chip-row'>
                    <span
                      className='wb-chip wb-chip-muted wb-idk'
                      role='img'
                      aria-label={_('Said honestly: not yet known')}
                    >
                      {_('Said honestly: not yet known')}
                    </span>
                  </div>
                )}
                {b.author === 'user' && <BlockChips check={checks[b.id]} />}
                <hr className='wb-sep' />
              </article>
            ))}

            {phase !== 'idle' && showPlaceholder && (
              <article className='wb-block'>
                <p className='wb-byline'>{_('THE PROFESSOR')}</p>
                <div className='wb-prose wb-streaming'>
                  {partial.trim()
                    ? (() => {
                        const disp = parseProfessorTags(stripPartialTagTail(partial)).display;
                        // Raw SVG never streams into the DOM uncommitted:
                        // a complete fence mid-stream holds a muted
                        // placeholder instead (s3 §3.2).
                        const { svg, display } = extractDiagramSvg(disp);
                        return (
                          <>
                            {renderContent(display)}
                            {svg !== '' && (
                              <p className='wb-figure-pending'>{_('The professor is drawing.')}</p>
                            )}
                          </>
                        );
                      })()
                    : null}
                  <span className='wb-nib' aria-hidden='true' />
                </div>
                {thinking && <p className='wb-thinking'>{_('The professor is writing.')}</p>}
                <hr className='wb-sep' />
              </article>
            )}

            {error && (
              <div className='wb-error'>
                <hr className='wb-sep' />
                {error.kind === 'no-provider' ? (
                  <NoKeyGuidance _={_} onOpen={openIntegrations} />
                ) : (
                  <div className='wb-error-body'>
                    {error.kind === 'text-layer' ? (
                      <>
                        <p className='wb-error-copy'>{_("The book's ink isn't readable yet.")}</p>
                        <p className='wb-error-detail'>
                          {_(
                            'Open the book once so its text layer can be prepared, then try again.',
                          )}
                        </p>
                      </>
                    ) : error.kind === 'timeout' ? (
                      <>
                        <p className='wb-error-copy'>
                          {_('The professor waited 45 seconds with no answer.')}
                        </p>
                        <p className='wb-error-detail'>
                          {_('Check the connection to your AI provider, then try again.')}
                        </p>
                      </>
                    ) : (
                      <p className='wb-error-copy'>
                        {_('The professor could not finish this page. Nothing was lost.')}
                      </p>
                    )}
                    {error.retry && (
                      <button type='button' className='ink-btn' onClick={() => error.retry?.()}>
                        {_('Try again')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {blocks.length === 0 && phase === 'idle' && !error && (
              <div className='wb-empty'>
                <span className='ornament' role='img' aria-label={_('The workbench')}>
                  ✳
                </span>
                <p className='wb-empty-copy'>
                  {_(
                    'Sit down with the professor. Work the page line by line; your work is marked as you go.',
                  )}
                </p>
                {hasKey ? (
                  <button type='button' className='stamp-btn' onClick={() => void startSession()}>
                    {_('Start a session')}
                  </button>
                ) : (
                  <NoKeyGuidance _={_} onOpen={openIntegrations} />
                )}
              </div>
            )}
          </div>

          {showScrollChip && (
            <button type='button' className='wb-scroll-chip' onClick={scrollToBottomAndRepin}>
              {_('New writing below')}
              <PiCaretDown size={10} aria-hidden='true' />
            </button>
          )}
        </div>
      </div>

      <div className='wb-composer-wrap'>
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
        <div
          className='wb-composer'
          style={{ paddingBottom: `calc(8px + ${(safeAreaInsets?.bottom || 0) / 2}px)` }}
        >
          <button
            type='button'
            className='wb-fx'
            aria-label={_('Insert math')}
            title={_('Insert math')}
            onClick={openMath}
          >
            ƒx
          </button>
          <textarea
            ref={textareaRef}
            rows={composerRows}
            value={value}
            aria-label={_('Write to the professor')}
            placeholder={sessionActive ? _('Continue the argument…') : _('Answer the professor…')}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleComposerKey}
          />
        </div>
      </div>
    </div>
  );
};

export default WorkbenchTab;
