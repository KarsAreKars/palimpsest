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
import { useDeskVoice } from '@/app/reader/hooks/useDeskVoice';
import { getNarration } from '@/services/narration/speakMode';
import {
  startWorkbenchSession,
  sendWorkbenchTurn,
  type WorkbenchBlock,
  type WorkbenchErrorKind,
} from '@/services/professor/workbenchSession';
import { checkDerivation } from '@/services/professor/mathCheck';
import {
  consumeWorkbenchBridge,
  WORKBENCH_BRIDGE_EVENT,
  type WorkbenchBridgeRequest,
} from '@/services/professor/bridge';
import {
  WORKBENCH_TRANSCRIPT_FILENAME,
  MAX_STEPS_PER_CHECK,
  associateLearnerStep,
  commitProfessorBlock,
  extractMathSteps,
  isProbeSignal,
  newBlockId,
  parseTranscript,
  serializeTranscript,
  summarizeChecks,
  useWorkbenchChatStore,
  type BlockCheck,
  type ProbeStance,
  type TranscriptBlock,
} from './workbenchChat';
import { BlockBody, StreamingBody } from './blockBody';
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

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------
// The per-block renderers (BlockChips, PageChip, ProbeRow, ConceptMapSlip,
// ConsultMark, VoiceControl) moved to blockBody.tsx verbatim (d3 §A.2,
// audit R5/R11); the tab re-imports them through <BlockBody>. What stays
// here is the never-used state's guidance plate.

const NoKeyGuidance: React.FC<{ _: TranslationFunc; onOpen: () => void }> = ({ _, onOpen }) => (
  <div className='wb-nokey plate'>
    <p className='wb-nokey-body'>{_('The professor needs a connection before he can sit down.')}</p>
    <p className='wb-nokey-hint'>{_('Connect one in Settings → Integrations.')}</p>
    <button type='button' className='stamp-btn' onClick={onOpen}>
      {_('Open integrations')}
    </button>
  </div>
);

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

  const hasKey =
    Boolean(aiSettings?.enabled) &&
    (aiSettings?.provider === 'ollama' ||
      (aiSettings?.provider === 'ai-gateway'
        ? Boolean(aiSettings.aiGatewayApiKey)
        : Boolean(aiSettings?.openrouterApiKey)));

  // ── Voice answers (s4): the player wiring lives in useDeskVoice (audit
  //    R5) — one player per desk mount, narration owns audio focus.
  const { voicePropsFor, stop: stopVoice } = useDeskVoice(bookKey);

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
      // A new sitting gesture silences the old voice; so does leaving —
      // the voice stop itself is useDeskVoice's unmount cleanup (audit R5).
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

  // ── Bridge seed (audit R7b): the professor's "take it to the desk" plate ──
  // arrives as a one-shot handoff. Seeding appends the question as a plain
  // user block; the opening composition carries it via the history summary.
  useEffect(() => {
    const seedAndStart = (question: string) => {
      stopVoice();
      appendBlock(bookKey, {
        id: newBlockId(),
        author: 'user',
        content: question,
        at: new Date().toISOString(),
      });
      startSession();
    };
    const staged = consumeWorkbenchBridge(bookKey);
    if (staged) seedAndStart(staged.question);
    const onBridge = (ev: Event) => {
      const req = (ev as CustomEvent<WorkbenchBridgeRequest>).detail;
      if (req?.bookKey !== bookKey) return;
      const handoff = consumeWorkbenchBridge(bookKey) ?? req;
      seedAndStart(handoff.question);
    };
    window.addEventListener(WORKBENCH_BRIDGE_EVENT, onBridge);
    return () => window.removeEventListener(WORKBENCH_BRIDGE_EVENT, onBridge);
  }, [bookKey, appendBlock, startSession]);

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
      stopVoice();
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
    [value, bookKey, appendBlock, respond, commitPartialIfAny, setBlocks, stopVoice],
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
              <BlockBody
                key={b.id}
                b={b}
                blocks={blocks}
                check={checks[b.id]}
                checks={checks}
                resumeFirst={i === 0 && !resumeNotice}
                voice={voicePropsFor(b)}
                onOpenThread={scrollToBlock}
                onPickProbe={pickProbe}
                quoteForPage={quoteForPage}
                onGoPage={goToPage}
              />
            ))}

            {phase !== 'idle' && showPlaceholder && (
              <StreamingBody
                partial={partial}
                thinking={thinking}
                quoteForPage={quoteForPage}
                onGoPage={goToPage}
              />
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
