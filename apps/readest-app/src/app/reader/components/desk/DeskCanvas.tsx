/**
 * DeskCanvas — the sheet stage: one fluid 720px column of professor/you
 * blocks on endless paper, the click-anywhere floating composer, and the
 * pinned-follow scroll policy (d2 §4–7; audit R1/R3/R6).
 *
 * This component REPLACES the retired notebook tab: the per-block faces it
 * renders are BlockBody/StreamingBody from notebook/blockBody (the wave-2
 * extraction — same wb-* DOM, reused, never forked); the streaming/turn
 * machinery, session bootstrap, and bridge-seed front door live in
 * useDeskStreaming (harvested verbatim per audit R4/R6); the transcript
 * document's load/save lives in useTranscriptPersistence (d2 §8); the voice
 * player's wiring lives in useDeskVoice (audit R5).
 *
 * Contracts owned HERE (audit R3): scrollRef, pinned/growth, the 24px pin,
 * the smooth-glide/instant-token policy, the width-drag re-anchor,
 * mount/rest-at-bottom, scrollToBlock (exposed through the forwarded ref
 * as DeskCanvasHandle — DeskSheet wires the rail's onOpenThread to it),
 * click-to-place hit-testing, and the empty-sheet stamp button (R6).
 *
 * Not virtualized (d2 §5): revisit when a measured scrollHeight > 200_000px
 * OR blocks.length > 500 — then file the virtualization follow-up. Until
 * then: plain flow. (Risk 2b: an additive content-visibility mitigation is
 * pre-authorized for the queen if dogfood shows jank.)
 */
'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import 'katex/dist/katex.min.css';
import { PiCaretDown } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { getNarration } from '@/services/narration/speakMode';
import { useDeskVoice } from '@/app/reader/hooks/useDeskVoice';
import {
  useWorkbenchChatStore,
  type BlockCheck,
  type ProbeStance,
  type TranscriptBlock,
} from '../notebook/workbenchChat';
import { BlockBody, StreamingBody } from '../notebook/blockBody';
import {
  DESK_PIN_THRESHOLD_PX,
  clampComposerPosition,
  deskComposerReducer,
  idleComposer,
  isWritablePoint,
  type BlockRect,
  type SheetPoint,
} from './deskGeometry';
import { isSpatialSheet, layoutSheet } from './deskLayout';
import { useDeskStreaming } from './useDeskStreaming';
import { useTranscriptPersistence } from './useTranscriptPersistence';
import DeskComposer from './DeskComposer';

/** True when the reader asked the motion to stop — glides collapse to
 *  instant jumps (§12). */
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The never-used state's guidance plate (harvested with the empty state,
 *  audit R6 — same classes, same copy). */
const NoKeyGuidance: React.FC<{ _: TranslationFunc; onOpen: () => void }> = ({ _, onOpen }) => (
  <div className='wb-nokey plate'>
    <p className='wb-nokey-body'>{_('The professor needs a connection before he can sit down.')}</p>
    <p className='wb-nokey-hint'>{_('Connect one in Settings → Integrations.')}</p>
    <button type='button' className='stamp-btn' onClick={onOpen}>
      {_('Open integrations')}
    </button>
  </div>
);

/** What the sheet host needs from the canvas — DeskSheet holds this ref
 *  and wires the rail's chip glide to it (audit R3(c)). */
export interface DeskCanvasHandle {
  scrollToBlock: (id: string) => void;
}

const EMPTY_BLOCKS: TranscriptBlock[] = [];
const EMPTY_CHECKS: Record<string, BlockCheck> = {};

/** Content-coordinate top of an element within the scroll box — the
 *  rect-based measure works for flow articles and for absolutely placed
 *  spatial-cluster articles alike (offsetTop is wrapper-relative under
 *  absolute positioning, so the pivot cannot use it). */
const contentTop = (scroll: HTMLElement, a: HTMLElement): number =>
  a.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;

/** The floating plate's assumed size for clamping before it mounts —
 *  clampComposerPosition only needs a sane estimate to keep the plate on
 *  the visible sheet. */
const COMPOSER_ESTIMATE = { width: 360, height: 150 };

const DeskCanvas = forwardRef<DeskCanvasHandle, { bookKey: string }>(({ bookKey }, ref) => {
  const _ = useTranslation();
  const blocks = useWorkbenchChatStore((s) => s.blocks[bookKey]) ?? EMPTY_BLOCKS;
  const checks = useWorkbenchChatStore((s) => s.checks[bookKey]) ?? EMPTY_CHECKS;

  const aiSettings = useSettingsStore((s) => s.settings.aiSettings);
  const hasKey =
    Boolean(aiSettings?.enabled) &&
    (aiSettings?.provider === 'ollama' ||
      (aiSettings?.provider === 'ai-gateway'
        ? Boolean(aiSettings.aiGatewayApiKey)
        : Boolean(aiSettings?.openrouterApiKey)));

  // ── Harvested hooks (audit R4/R5/R6): the whole turn machinery lives
  //    component-local inside the desk subtree, never in the store.
  const { voicePropsFor, stop: stopVoice } = useDeskVoice(bookKey);
  const streaming = useDeskStreaming(bookKey, { stopVoice });
  const { resumeNotice } = useTranscriptPersistence(bookKey);

  const openIntegrations = useCallback(() => {
    useSettingsStore.getState().setRequestedPanel('Integrations');
    useSettingsStore.getState().setSettingsDialogOpen(true);
  }, []);

  // ── The floating composer state machine (d2 §7.1) ─────────────────────
  const [composer, dispatch] = useReducer(deskComposerReducer, idleComposer);

  // ── Scroll policy (§8): pinned follow, no yank, one quiet stamp chip ───
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const committedCountRef = useRef(0);
  const [pinned, setPinned] = useState(true);
  const [growth, setGrowth] = useState(false);

  const atBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= DESK_PIN_THRESHOLD_PX;
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
      const top = contentTop(el, a);
      if (top >= el.scrollTop - 1) {
        anchorRef.current = { id: a.dataset['bid'] ?? '', offset: top - el.scrollTop };
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
      el.scrollTop = Math.min(
        Math.max(contentTop(el, target) - anchor.offset, 0),
        Math.max(max, 0),
      );
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

  const partial = streaming.partial;
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

  // ── Spatial layout (PENECHO pivot, e4 R4/R5): when any block carries
  //    placement the sheet goes spatial — placed clusters are positioned
  //    absolutely from the pure layoutSheet pass; column clusters keep the
  //    legacy 720px measure inside the same stage. Legacy sheets (no
  //    placement anywhere) render today's single centered column,
  //    byte-identical — zero migration, TRANSCRIPT_VERSION stays 1.
  const [stageWidth, setStageWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    const col = columnRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setStageWidth(columnRef.current?.clientWidth ?? el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (col) ro.observe(col); // the :has() full-width flip resizes the column
    return () => ro.disconnect();
  }, [bookKey]);

  const spatial = isSpatialSheet(blocks);
  const sheetLayout = useMemo(
    () => (spatial && stageWidth > 0 ? layoutSheet(blocks, stageWidth) : null),
    [spatial, blocks, stageWidth],
  );

  // ── Page chips: evidence you can travel to (the click scrolls the book
  //    through the reader view's existing goTo) ──────────────────────────
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
   *  concept was last discussed (s1 §5.2). Also the DeskCanvasHandle the
   *  rail's onOpenThread is wired to (audit R3(c)). */
  const scrollToBlock = useCallback((id: string) => {
    const target = scrollRef.current?.querySelector(`article[data-bid="${id}"]`);
    target?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
  }, []);

  useImperativeHandle(ref, () => ({ scrollToBlock }), [scrollToBlock]);

  // ── Click-to-place (PENECHO R1): any empty paper accepts ink — the
  //    tail OR a gap between blocks; clicking ON a block stays inert. ───
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Interactive children (chips, buttons, the composer plate) own their
    // own clicks — placement is the empty paper's gesture alone. NOTE: the
    // sheet root itself has role='dialog', so guard by the composer's class
    // — guarding on [role="dialog"] swallows EVERY click on the sheet
    // (owner dogfood: "nothing I type seems to be working").
    if (
      (e.target as HTMLElement).closest(
        'button, a, input, textarea, select, math-field, .desk-composer, .wb-math-popover',
      )
    ) {
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pointY = e.clientY - rect.top + el.scrollTop;
    const rects: BlockRect[] = Array.from(
      el.querySelectorAll<HTMLElement>('article[data-bid]'),
    ).map((a) => {
      const top = contentTop(el, a);
      const bRect = a.getBoundingClientRect();
      return {
        id: a.dataset['bid'] ?? '',
        top,
        bottom: top + bRect.height,
        left: bRect.left - rect.left,
        right: bRect.right - rect.left,
      };
    });
    const pointX = e.clientX - rect.left;
    if (!isWritablePoint(rects, el.scrollHeight, pointY, pointX)) return;
    const point: SheetPoint = { x: pointX, y: e.clientY - rect.top };
    dispatch({ type: 'PLACE', point });
  }, []);

  // ── The composer: clamp, dismiss, commit ──────────────────────────────
  const viewportBox = scrollRef.current
    ? { width: scrollRef.current.clientWidth, height: scrollRef.current.clientHeight }
    : null;
  const placedPoint =
    composer.kind === 'placed' || composer.kind === 'composing' ? composer.point : null;
  // The plate rides INSIDE the scroll container (it must scroll with the
  // paper), but clicks are viewport-relative — so clamp in viewport space,
  // then translate into content space by adding the live scrollTop
  // (owner dogfood: "where I click and where it goes is 2 separate places").
  const liveScrollTop = scrollRef.current?.scrollTop ?? 0;
  const platePosition =
    placedPoint && viewportBox
      ? (() => {
          const c = clampComposerPosition(placedPoint, viewportBox, COMPOSER_ESTIMATE);
          return { left: c.left, top: c.top + liveScrollTop };
        })()
      : { left: 8, top: 8 };
  const caretPosition =
    placedPoint && viewportBox
      ? (() => {
          const c = clampComposerPosition(placedPoint, viewportBox, { width: 2, height: 16 });
          return { left: c.left, top: c.top + liveScrollTop };
        })()
      : { left: 8, top: 8 };

  const handleDismiss = useCallback(() => {
    dispatch({ type: 'DISMISS' }); // clears the text (d2 §7.1 DISMISS)
    scrollRef.current?.focus(); // focus returns to the sheet container
  }, []);

  const handleSend = useCallback(() => {
    if (composer.kind !== 'composing') return;
    const text = composer.text;
    const el = scrollRef.current;
    const column = columnRef.current;
    // Sheet-content coordinates (px, d2 §2.1). In spatial mode the origin
    // is the stage's top-left (the layoutSheet coordinate space); in the
    // legacy column it is the click point as before. The professor's reply
    // clusters beside/under the anchor at this point (PENECHO R4/R5).
    const stage = stageRef.current;
    const placement =
      el && column && text.trim()
        ? {
            x: Math.round(composer.point.x - (stage?.offsetLeft ?? 0)),
            y: Math.round(composer.point.y + el.scrollTop - (stage?.offsetTop ?? 0)),
            width: Math.round(stage?.clientWidth ?? column.offsetWidth),
          }
        : undefined;
    dispatch({ type: 'SEND' });
    if (text.trim()) streaming.sendTurn(text, placement);
  }, [composer, streaming]);

  // SENT / stream settle → idle (d2 §7.1).
  useEffect(() => {
    if (composer.kind === 'sending' && streaming.phase === 'idle') {
      dispatch({ type: 'SENT' });
    }
  }, [composer.kind, streaming.phase]);

  // ── Render ────────────────────────────────────────────────────────────
  const sessionActive = blocks.length > 0 || streaming.phase !== 'idle';
  const showScrollChip = !pinned && growth;
  // A folio is open while the last professor block carries a derivation —
  // only a later professor prose block closes it (s3 §7.3, §10 Q2).
  const folioOpen = Boolean(
    [...blocks].reverse().find((b) => b.author === 'professor')?.derivation,
  );
  const error = streaming.error;

  // The per-block faces are identical in both modes — only their placement
  // on the sheet differs (flow column vs laid-out cluster slot).
  const renderBlock = (b: TranscriptBlock, i: number) => (
    <BlockBody
      key={b.id}
      b={b}
      blocks={blocks}
      check={checks[b.id]}
      checks={checks}
      resumeFirst={i === 0 && !resumeNotice}
      voice={voicePropsFor(b)}
      onOpenThread={scrollToBlock}
      onPickProbe={(blockId: string, stance: ProbeStance, message: string) =>
        streaming.sendProbePick(blockId, stance, message)
      }
      quoteForPage={quoteForPage}
      onGoPage={goToPage}
    />
  );
  const streamingBody = (
    <StreamingBody
      partial={streaming.partial}
      thinking={streaming.thinking}
      quoteForPage={quoteForPage}
      onGoPage={goToPage}
    />
  );
  const streamingOn = streaming.phase !== 'idle' && streaming.showPlaceholder;

  return (
    <div
      className='desk-canvas'
      ref={scrollRef}
      onScroll={handleScroll}
      onClick={handleCanvasClick}
      role='log'
      aria-live='polite'
      aria-relevant='additions'
      tabIndex={0}
    >
      <div className='desk-column' ref={columnRef}>
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

        {sheetLayout ? (
          /* Spatial mode (PENECHO R4/R5): every block sits at its laid-out
             slot — placed anchors at their stored point, professor
             artifacts beside/below the anchor, column clusters in the
             legacy measure. The stage reserves the estimated extent so the
             tail paper follows the last cluster. */
          <div className='desk-spatial' ref={stageRef} style={{ minHeight: sheetLayout.extent }}>
            {blocks.map((b, i) => {
              const slot = sheetLayout.placements.get(b.id);
              if (!slot) return null;
              return (
                <div
                  key={b.id}
                  className='desk-cluster-item'
                  style={{ left: slot.x, top: slot.y, width: slot.width }}
                >
                  {renderBlock(b, i)}
                </div>
              );
            })}
            {streamingOn && sheetLayout.streamSlot && (
              <div
                className='desk-cluster-item desk-cluster-stream'
                style={{
                  left: sheetLayout.streamSlot.x,
                  top: sheetLayout.streamSlot.y,
                  width: sheetLayout.streamSlot.width,
                }}
              >
                {streamingBody}
              </div>
            )}
          </div>
        ) : (
          <>
            {blocks.map(renderBlock)}

            {streamingOn && streamingBody}
          </>
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
                      {_('Open the book once so its text layer can be prepared, then try again.')}
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

        {blocks.length === 0 && streaming.phase === 'idle' && !error && !hasKey && (
          // No chat ceremony (owner ruling 2026-09-16): the paper is the
          // affordance — click anywhere, write, Enter. Only the missing
          // provider key gets a plate.
          <div className='wb-empty'>
            <NoKeyGuidance _={_} onOpen={openIntegrations} />
          </div>
        )}

        {/* Endless paper below the conversation — always clickable (d2 §5). */}
        <div className='desk-tail' aria-hidden='true' />
      </div>

      {composer.kind === 'placed' && (
        <span
          className='desk-caret'
          aria-hidden='true'
          style={{ left: caretPosition.left, top: caretPosition.top }}
        />
      )}
      {(composer.kind === 'placed' || composer.kind === 'composing') && (
        <DeskComposer
          state={composer}
          position={platePosition}
          sessionActive={sessionActive}
          folioOpen={folioOpen}
          onFocus={() => dispatch({ type: 'FOCUS' })}
          onChange={(text) => dispatch({ type: 'CHANGE', text })}
          onSend={handleSend}
          onDismiss={handleDismiss}
        />
      )}

      {showScrollChip && (
        <button type='button' className='wb-scroll-chip' onClick={scrollToBottomAndRepin}>
          {_('New writing below')}
          <PiCaretDown size={10} aria-hidden='true' />
        </button>
      )}
    </div>
  );
});

DeskCanvas.displayName = 'DeskCanvas';

export default DeskCanvas;
