/**
 * useDeskStreaming — the workbench's streaming/turn machinery, harvested
 * verbatim from the retired notebook tab (Desk campaign wave 3, d2 §7.4 + audit
 * R4/R6: the extraction range is L622–817, adding `startSession` and the
 * bridge-seed effect, retry ref and all).
 *
 * `beginStream`/`streamCallbacks`/`respond`/`runSilentCheck`/
 * `commitPartialIfAny` are copied, not redesigned — the 2026-09-06
 * crash-scar rule stands: all streaming state is component-local (useState/
 * useRef inside the desk subtree) and never touches the zustand store.
 * One extraction, no copies (audit R4): the desk composer is the only
 * send path left, and it calls `sendTurn` here.
 *
 * Stop-on-new-turn / stop-on-seed: the caller passes its voice `stop` (from
 * useDeskVoice, audit R5) and this hook fires it as the FIRST statement of
 * `sendTurn` and of the bridge seed — the same position `send()` had in the
 * tab (audit Risk 4).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSettingsStore } from '@/store/settingsStore';
import { checkDerivation } from '@/services/professor/mathCheck';
import {
  startWorkbenchSession,
  sendWorkbenchTurn,
  type WorkbenchBlock,
  type WorkbenchErrorKind,
} from '@/services/professor/workbenchSession';
import {
  consumeWorkbenchBridge,
  WORKBENCH_BRIDGE_EVENT,
  type WorkbenchBridgeRequest,
} from '@/services/professor/bridge';
import {
  MAX_STEPS_PER_CHECK,
  buildUserBlock,
  commitProfessorBlock,
  extractMathSteps,
  newBlockId,
  summarizeChecks,
  useWorkbenchChatStore,
  type BlockCheck,
  type ProbeStance,
  type TranscriptBlock,
} from '../notebook/workbenchChat';

/** The professor-block placeholder mounts only after this long in flight,
 *  so a fast first token never flickers a placeholder. */
const PLACEHOLDER_DELAY_MS = 400;
/** After this long with no tokens, the patience line fades in. */
const THINKING_DELAY_MS = 3000;
/** The silent check may hold the professor's reply at most this long. */
const CHECK_BUDGET_MS = 2500;

const NO_KEY_PATTERN = /No AI provider configured|provider is not configured/i;

/** A cheap content hash for silent-check skipping: only blocks whose text
 *  changed since their last check are re-submitted (never the quadratic
 *  whole-transcript re-check). */
const contentHash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
};

export interface DeskStreaming {
  phase: 'idle' | 'awaiting' | 'streaming';
  partial: string;
  showPlaceholder: boolean;
  thinking: boolean;
  error: { kind: WorkbenchErrorKind; retry: (() => void) | null } | null;
  /** Commit the learner's turn: partial-commit, silent check, then the
   *  professor answers. Placement rides the block as surface metadata —
   *  it never enters the prompt (d2 §3). */
  sendTurn: (content: string, placement?: { x?: number; y?: number; width?: number }) => void;
  /** The professor opens a sitting (the empty sheet's stamp button). */
  startSession: () => void;
  /** The probe-chip pick rides the same path as a typed message. */
  sendProbePick: (blockId: string, stance: ProbeStance, message: string) => void;
  /** The current error's retry closure, if any. */
  retry: (() => void) | null;
}

export const useDeskStreaming = (
  bookKey: string,
  opts: { stopVoice: () => void },
): DeskStreaming => {
  const aiSettings = useSettingsStore((s) => s.settings.aiSettings);
  const appendBlock = useWorkbenchChatStore((s) => s.appendBlock);
  const setBlocks = useWorkbenchChatStore((s) => s.setBlocks);
  const setCheck = useWorkbenchChatStore((s) => s.setCheck);
  const markProbePicked = useWorkbenchChatStore((s) => s.markProbePicked);

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
      opts.stopVoice();
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
    // opts.stopVoice is useDeskVoice's stable `stop` (useCallback, []).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, appendBlock, startSession]);

  // ── Silent checking (no check button; it just happens) ─────────────────
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
      // answering — but the checker never gets to delay him long:
      // never interrupt.
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

  // ── The send pipeline (d2 §3): buildUserBlock is the single commit path ──
  const sendTurn = useCallback(
    (content: string, placement?: { x?: number; y?: number; width?: number }) => {
      // Stop-on-new-turn (s4 §5 law 3): the FIRST statement — a probe-chip
      // pick rides sendTurn too, so it inherits silence (audit Risk 4).
      opts.stopVoice();
      const text = content.trim();
      if (!text) return; // a quiet no-op — no disabled state, no error
      if (phaseRef.current !== 'idle') commitPartialIfAny();
      const priorBlocks = useWorkbenchChatStore.getState().blocks[bookKey] ?? [];
      const { block: userBlock, associated } = buildUserBlock(priorBlocks, {
        content: text,
        ...(placement?.x !== undefined ? { x: placement.x } : {}),
        ...(placement?.y !== undefined ? { y: placement.y } : {}),
        ...(placement?.width !== undefined ? { width: placement.width } : {}),
      });
      if (associated !== priorBlocks) setBlocks(bookKey, associated);
      appendBlock(bookKey, userBlock);
      const history = [...(useWorkbenchChatStore.getState().blocks[bookKey] ?? [])];
      void respond(history, userBlock.content);
    },
    [bookKey, appendBlock, respond, commitPartialIfAny, setBlocks],
  );

  /** The probe chip pick is an ordinary student message through sendTurn —
   *  partial-commit, silent-check, and history all behave identically to a
   *  typed message (s1 §5.2). */
  const sendProbePick = useCallback(
    (blockId: string, stance: ProbeStance, message: string) => {
      markProbePicked(bookKey, blockId, stance);
      sendTurn(message);
    },
    [bookKey, markProbePicked, sendTurn],
  );

  return {
    phase,
    partial,
    showPlaceholder,
    thinking,
    error,
    sendTurn,
    startSession,
    sendProbePick,
    retry: error?.retry ?? null,
  };
};
