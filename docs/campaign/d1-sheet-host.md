# D1 — Sheet Host + Chrome (The Desk, Workbench 3.0)

**Lane owner:** scout → writer D1.
**Campaign law:** `docs/DESK_CAMPAIGN.md` is binding. Vision: `docs/vision/THE_DESK.md`.
Binding product defaults applied here: **(1) the sidebar Workbench tab is
removed when the Desk lands — one surface; (2) one endless sheet per book;
(3) single fluid column v1** (freeform `(x,y)` is specced additively by
another lane, not this one). Non-negotiable **7** (book ghost-visible under a
scrim) and **8** (single focus owner) are implemented by this spec.
**Design world:** The Antiquarian Catalogue — librarian voice `_()`, stamp
`#8C3B22` (`var(--stamp)`, `apothecary.css:46`) the sole accent, light mode,
corners ≤ 2px, unlayered CSS, protocol tags never displayed.

The Desk is a **full-page overlay that slides out from underneath the PDF**:
same dimensions as the page area, book dimmed but ghost-visible behind a
scrim, dismissed by Esc and by the header toggle. This spec covers the host,
the chrome, the animation, focus/Escape, and the removal of the notebook
Workbench tab (constitution default 1). The canvas layout, click-to-place
composer, rail, and block renderers are other lanes' specs; this host gives
them their stage.

---

## 0. Files touched

| File | Change |
|---|---|
| `apps/readest-app/src/store/deskStore.ts` | **New.** Visibility state + toggle-element registry (§2). |
| `apps/readest-app/src/app/reader/components/DeskToggler.tsx` | **New.** Header toggle button beside `NotebookToggler` (§3). |
| `apps/readest-app/src/app/reader/components/HeaderBar.tsx` | Mount `<DeskToggler bookKey={bookKey} />` in `header-tools-end`, immediately before `<NotebookToggler bookKey={bookKey} />` (HeaderBar.tsx:315). |
| `apps/readest-app/src/app/reader/components/desk/DeskSheet.tsx` | **New.** The sheet host (§4–§6). |
| `apps/readest-app/src/app/reader/components/desk/desk.css` | **New.** `desk-` classes only, unlayered (§5.3). |
| `apps/readest-app/src/app/reader/components/BooksGrid.tsx` | Mount `<DeskSheet bookKey={bookKey} />` inside the gridcell, after the `slideRef` page wrapper (§4.2). |
| `apps/readest-app/src/store/notebookStore.ts` | Remove `'workbench'` from the `NotebookTab` union (§7.1). |
| `apps/readest-app/src/app/reader/components/notebook/NotebookTabNavigation.tsx` | Remove the `workbench` tab entry, label case, and inline SVG icon (§7.2). |
| `apps/readest-app/src/app/reader/components/notebook/Notebook.tsx` | Remove the `WorkbenchTab` lazy import, `DeskErrorBoundary`, `WorkbenchFallback`, and the `workbench` branch; guard the persisted-tab restore (§7.3). |
| `apps/readest-app/src/__tests__/reader/desk-sheet.test.ts` | **New** vitest file (§10). |
| `apps/readest-app/src/__tests__/reader/desk-store.test.ts` | **New** vitest file (§10). |

Writer gate: `npx tsc --noEmit` + focused vitest (`pnpm vitest run src/__tests__/reader/desk-`) green + no new biome errors in touched files.

---

## 1. Existing code this spec stands on (verified)

- `Reader.tsx:29-46` — the binding **z-index layering guide**: 50 dialogs/popups, 45 sidebar/notebook unpinned, 40 TTS bar, 30 TTS control, 20 header/footbar/notebook pinned, 10 headerbar, 0 base. The Desk slots between base and headerbar (§6.3 amends the guide).
- `ReaderContent.tsx:352-380` — the reader stage: `.reader-content full-height flex` renders `<SideBar />`, `<BooksGrid …/>`, then `<Notebook />`. `Notebook` is a sibling overlay, **not** a route — the Desk follows the same pattern.
- `BooksGrid.tsx:152-158` — each book cell is
  ```tsx
  <div id={`gridcell-${bookKey}`} data-view-transition-root=''
       className={clsx('relative h-full w-full overflow-hidden', …)}>
    <HeaderBar … />
    <div ref={slideRef} className='bg-paper absolute inset-0'> … <FoliateViewer …/> … </div>
  ```
  The cell is `relative`; the book page area is exactly the `slideRef` wrapper (`absolute inset-0`). A sheet mounted as a later sibling at `absolute inset-0` with a z between 0 and the header's `z-10` owns the page area while the header stays live.
- `HeaderBar.tsx:315` — `<NotebookToggler bookKey={bookKey} />` in `header-tools-end`; `HeaderBarProps` (HeaderBar.tsx:36-45) already carries `bookKey`. The Desk toggle mounts beside it, same props.
- `NotebookToggler.tsx:24-32` — the toggle precedent: `sideBarBookKey === bookKey ? toggleNotebook() : setSideBarBookKey(bookKey); if (!isNotebookVisible) toggleNotebook();`, wrapped in `@/components/Button` (`icon`, `onClick`, `label`; 44px touch halo per Button.tsx:20-24). `SidebarToggler.tsx:13-33` adds the filled/active-icon idiom (`TbLayoutSidebarFilled` when active). The Desk toggle combines both patterns (§3).
- `notebookStore.ts:4` — `export type NotebookTab = 'spine' | 'notes' | 'study' | 'workbench';` and the zustand `create<NotebookState>((set, get) => …)` shape this spec's `deskStore` mirrors.
- `Notebook.tsx:48-84` — the Workbench mount contract: `const WorkbenchTab = lazy(() => import('./WorkbenchTab'));` (line 48) behind `DeskErrorBoundary` (quiet-paper fallback, `_('This desk is being restored.')`, line 58) and `<Suspense fallback={null}>`; the render branch is `notebookActiveTab === 'workbench' ? (…<WorkbenchTab bookKey={sideBarBookKey} />…)` (Notebook.tsx:505-511). **These move to DeskSheet.tsx verbatim** — the lazy import and error boundary are not deleted, they change hosts (§7.4).
- `WorkbenchTab.tsx:405` — `const WorkbenchTab: React.FC<{ bookKey: string }>`; transcript state is keyed by bookKey via `useWorkbenchChatStore` (workbenchChat.ts:470-490: `blocks: Record<string, TranscriptBlock[]>`), so the Desk inherits per-book persistence by passing `bookKey` through.
- `types/book.ts:480-498` — `BookProgress { … page: number; pageinfo: PageInfo; sectionLabel: string; … }`; `getProgress: (key: string) => BookProgress | null` is on `useReaderStore` (readerStore.ts:93). `Notebook.tsx` already resolves the current book the same way: `sideBarBookKey` from `useSidebarStore` + `getBookData(sideBarBookKey)`.
- `useShortcuts.ts:31-36,50-53` — the Esc precedent: `useShortcuts({ onEscape })` (used by Notebook.tsx:133) ignores keydown while focus is in an `INPUT`/`TEXTAREA`/contentEditable (except Escape out of `.note-editor`), so typing in the desk composer never trips the dismiss.
- `WorkbenchTab.css:583-596` — the reduced-motion precedent: `@media (prefers-reduced-motion: reduce) { … transition: none; … }` inside the component stylesheet.
- `chrome.css` — header buttons are `chrome-ghost chrome-btn-icon h-8 min-h-8 w-8`; the header's only accent rule is `.header-bar .chrome-btn:hover { color: var(--stamp); … }` (chrome.css:169-172). Notebook tab active state uses `text-stamp`/`bg-stamp` utilities (NotebookTabNavigation.tsx:88,93) — both Tailwind-mapped and safe to reuse.
- `ProfOverlay.tsx:103,106,173` — the professor overlay renders `fixed z-40` scrim and `z-50` bubbles above everything chrome-level. The Desk must stay **below** it so the professor can speak over the desk.
- `@/components/Overlay` — the existing pointer-dismiss layer (`fixed inset-0`, `onDismiss` on click, `aria-hidden`) used by the unpinned notebook (Notebook.tsx:398-403). The Desk does **not** use it: its scrim is not a dismiss surface (non-negotiable 7 wants the book consulted, not dismissed — §5.2).
- Tests: vitest + jsdom (`vitest.config.mts`), `@testing-library/dom` + `@testing-library/react` are devDependencies (package.json:232-233); `src/__tests__/reader/autohide-cursor.test.ts` is the DOM-test style model.

---

## 2. `deskStore.ts` — new file, exact source

```ts
// apps/readest-app/src/store/deskStore.ts
import { create } from 'zustand';

interface DeskState {
  isDeskVisible: boolean;
  getIsDeskVisible: () => boolean;
  toggleDesk: () => void;
  setDeskVisible: (visible: boolean) => void;
  /** The header toggle button registers itself so the sheet can return
   *  focus to it on dismiss (constitution non-negotiable 8). */
  toggleElement: HTMLElement | null;
  setToggleElement: (el: HTMLElement | null) => void;
}

export const useDeskStore = create<DeskState>((set, get) => ({
  isDeskVisible: false,
  toggleElement: null,
  getIsDeskVisible: () => get().isDeskVisible,
  toggleDesk: () => set((state) => ({ isDeskVisible: !state.isDeskVisible })),
  setDeskVisible: (visible: boolean) => set({ isDeskVisible: visible }),
  setToggleElement: (el) => set({ toggleElement: el }),
}));
```

Notes for the writer:
- `setDeskVisible` sets an absolute value (idempotent — used by Esc, overlay
  paths, and tests); `toggleDesk` is only for the header button. This mirrors
  `setNotebookVisible`/`toggleNotebook` in notebookStore.ts:64-65.
- No `bookKey`, no page, no transcript state here. The Desk **reads** the
  current book from `useSidebarStore`'s `sideBarBookKey` at render time
  (exactly as `Notebook.tsx:90` does); the transcript stays in
  `useWorkbenchChatStore` keyed by bookKey. One focus owner = one visibility
  boolean; everything else is derived (campaign non-negotiable 8).

---

## 3. `DeskToggler.tsx` — the header toggle, exact source

```tsx
// apps/readest-app/src/app/reader/components/DeskToggler.tsx
import React, { useEffect, useRef } from 'react';
import { LuLampDesk } from 'react-icons/lu';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useDeskStore } from '@/store/deskStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface DeskTogglerProps {
  bookKey: string;
}

const DeskToggler: React.FC<DeskTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isDeskVisible, toggleDesk, setDeskVisible } = useDeskStore();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const iconSize18 = useResponsiveSize(18);

  useEffect(() => {
    useDeskStore.getState().setToggleElement(buttonRef.current);
    return () => useDeskStore.getState().setToggleElement(null);
  }, []);

  const handleToggleDesk = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    if (sideBarBookKey === bookKey) {
      toggleDesk();
    } else {
      setSideBarBookKey(bookKey);
      if (!isDeskVisible) setDeskVisible(true);
    }
  };

  const isActive = sideBarBookKey === bookKey && isDeskVisible;

  return (
    <span ref={buttonRef} className='contents'>
      <Button
        icon={<LuLampDesk size={iconSize18} className={isActive ? 'text-stamp' : 'text-ink'} />}
        onClick={handleToggleDesk}
        label={isActive ? _('Close the Desk') : _('Open the Desk')}
      />
    </span>
  );
};

export default DeskToggler;
```

Decisions, grounded:
- **Icon: `LuLampDesk`** (react-icons/lu — verified exported in
  `react-icons@5.6.0`). Vision names "a desktop/desk lamp or layered-sheet
  glyph"; the lamp reads at 16px (chrome.css:72-77 pins header svgs to 16px)
  and is unmistakably a *desk*. Do not reuse `RiQuillPenLine` (owned by the
  notebook) or the workbench tab's inline pencil-over-ruled-paper SVG
  (deleted with the tab, §7.2).
- **Active state in stamp**: `text-stamp` when the desk is open for this book
  — the same accent the notebook tab row uses (`text-stamp`,
  NotebookTabNavigation.tsx:93). No fill, no new colors: stamp is the sole
  accent. Focus-visible keeps the global `chrome-ghost:focus-visible` stamp
  outline (chrome.css:64-67).
- The `handleToggleDesk` branching copies `NotebookToggler.tsx:24-32` so a
  toggle on a non-focused book focuses that book first.
- `Button` renders the `<button>`; `aria-label` flips with state so screen
  readers announce dismiss vs open. `buttonRef` wraps in a `span.contents`
  because `Button` doesn't forward refs — the registry needs a stable element
  for focus return (§6.2).
- `appService?.isMobile → setHoveredBookKey('')` mirrors NotebookToggler:27-29
  (clears the hover-revealed chrome so the desk takes the stage unobstructed).

**HeaderBar wiring** (one line, after `HeaderBar.tsx:315`):
```tsx
<DeskToggler bookKey={bookKey} />
<NotebookToggler bookKey={bookKey} />
```

---

## 4. `DeskSheet.tsx` — the sheet host

### 4.1 Component API (exact)

```tsx
// apps/readest-app/src/app/reader/components/desk/DeskSheet.tsx
'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useDeskStore } from '@/store/deskStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useShortcuts } from '@/hooks/useShortcuts';
import { lazy, Suspense } from 'react';

import './desk.css';

// Re-hosted, not rewritten: the workbench desk's mount contract moves here
// verbatim from Notebook.tsx (2026-09-06 lesson: a chat-runtime crash must
// never propagate past this panel).
const WorkbenchTab = lazy(() => import('../notebook/WorkbenchTab'));

/** Quiet paper fallback when the workbench desk crashes. */
const DeskFallback: React.FC = () => {
  const _ = useTranslation();
  return (
    <div className='flex flex-grow items-center justify-center px-3'>
      <div className='border-ink/25 bg-paperlight rounded-sm border px-4 py-6 text-center'>
        <p className='typed text-mutedink text-[9px] leading-relaxed'>
          {_('This desk is being restored.')}
        </p>
      </div>
    </div>
  );
};

class DeskErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { crashed: boolean }
> {
  override state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error('[desk] sheet crashed; sealed behind fallback', error);
  }
  override render() {
    return this.state.crashed ? <DeskFallback /> : this.props.children;
  }
}

export interface DeskSheetProps {
  /** The book this cell renders. The caller only mounts DeskSheet for the
   *  focused book (bookKey === sideBarBookKey), so this is the desk's book. */
  bookKey: string;
}

const DeskSheet: React.FC<DeskSheetProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { isDeskVisible, setDeskVisible } = useDeskStore();
  const sheetRef = useRef<HTMLDivElement>(null);
  const progress = useReaderStore((s) => s.getProgress(bookKey));
  const { getBookData } = useBookDataStore();
  const bookData = getBookData(bookKey);

  const handleDismiss = useCallback(() => setDeskVisible(false), [setDeskVisible]);
  useShortcuts({ onEscape: handleDismiss }, [handleDismiss]);

  // Focus trap + focus return (§6.2)
  useEffect(() => {
    if (!isDeskVisible) return;
    const sheet = sheetRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheet?.querySelector<HTMLElement>('[data-desk-initial-focus]')?.focus();
    return () => {
      const toggle = useDeskStore.getState().toggleElement;
      (toggle ?? previouslyFocused)?.focus?.();
    };
  }, [isDeskVisible]);

  if (!isDeskVisible || !bookData?.bookDoc) return null;

  return (
    <div
      ref={sheetRef}
      className={clsx(
        'desk-sheet paper-bg',
        'absolute inset-0 z-[5] flex flex-col',
        appService?.hasRoundedWindow && 'rounded-window',
      )}
      role='dialog'
      aria-modal='true'
      aria-label={_('The Desk')}
      // dir follows the book (Notebook.tsx:439 does the same via viewSettings)
      dir={bookData.bookDoc.metadata.language?.startsWith('ar') ? 'rtl' : 'ltr'}
    >
      <div className='desk-scrim' aria-hidden='true' />
      <header className='desk-head border-ink/25 flex h-11 flex-none items-center border-b px-4'>
        <span className='plate-title text-ink line-clamp-1 flex-1 text-[15px]'>
          {bookData.book.title}
        </span>
        <span className='typed text-mutedink text-[9px] uppercase tracking-wider'>
          {progress ? _('Page {{page}}', { page: progress.page }) : ''}
        </span>
        <button
          type='button'
          data-desk-initial-focus
          className='chrome-ghost chrome-btn-icon h-8 min-h-8 w-8'
          aria-label={_('Close the Desk')}
          onClick={handleDismiss}
        >
          {/* inline 16px close hairline-x, stroke currentColor, matches the
              notebook Header close idiom */}
          <svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' aria-hidden='true'>
            <path d='M3 3l10 10M13 3L3 13' />
          </svg>
        </button>
      </header>
      <div className='desk-stage min-h-0 flex-1 overflow-y-auto'>
        <DeskErrorBoundary>
          <Suspense fallback={null}>
            <WorkbenchTab bookKey={bookKey} />
          </Suspense>
        </DeskErrorBoundary>
      </div>
    </div>
  );
};

export default DeskSheet;
```

Typing notes the writer must honor:
- `useReaderStore((s) => s.getProgress(bookKey))` — `getProgress` is a stable
  store function (readerStore.ts:93), so this subscribes safely; `BookProgress
  .page` is the 1-based page number (types/book.ts:498, and Notebook.tsx:330
  uses `progress.page` identically).
- ` _('Page {{page}}', { page })` — the translation helper takes
  interpolation params (verify against `useTranslation`'s signature while
  writing; if it does not, fall back to ` _('Page') + ' ' + progress.page` —
  flag in review if the fallback is used).
- The header shows **book title + page**, the two facts that keep the book
  addressable while the desk owns the stage (§8). The sheet header is *inside*
  the sheet (z-[5]), below the book's `HeaderBar` (z-10): the real header
  stays live, so the DeskToggler and Esc both remain reachable, per the
  vision's "dismissed by the same header toggle".

### 4.2 Mount point (exact)

In `BooksGrid.tsx`, after the closing `</div>` of the `slideRef` page wrapper
(BooksGrid.tsx:177-265) and **before** `<BookmarkPullDown …/>`
(BooksGrid.tsx:266):

```tsx
{/* The Desk: full-page sheet over the page area; only for the focused book,
    so multi-book splits never stack two desks. Sits above the page wrapper,
    below HeaderBar (z-10). */}
{bookKey === sideBarBookKey && <DeskSheet bookKey={bookKey} />}
```

`sideBarBookKey` is already available in BooksGrid's scope (it consumes
`useReaderStore`; add `const { sideBarBookKey } = useSidebarStore();` if not
present). `DeskSheet` returns `null` when `isDeskVisible` is false, so the
cost of the per-cell mount is one store subscription.

**Why inside the gridcell, not in ReaderContent beside `<Notebook />`:** the
cell (`relative h-full w-full overflow-hidden`, BooksGrid.tsx:154) is exactly
"the page area" the vision names; mounting here gives (a) exact page-area
dimensions for free, (b) per-book scoping for multi-book splits, (c) clipping
by the cell's `overflow-hidden`, (d) immunity from `data-view-transition-root`
page-turn snapshots (the sheet is a sibling of, not inside, `slideRef`), and
(e) the header/footer stay above it without z-fighting.

### 4.3 How the Desk gets bookKey and page (contract for downstream lanes)

- **bookKey**: resolved by the caller — `DeskSheet` only mounts when
  `bookKey === sideBarBookKey` (§4.2) — and passed as the single source of
  truth prop. Downstream lanes (canvas, composer, rail) take `bookKey:
  string` from the Desk and key everything off it, exactly as `WorkbenchTab`
  keys `useWorkbenchChatStore` today.
- **page**: read via `useReaderStore((s) => s.getProgress(bookKey))?.page` at
  render. It is **display-only** in D1. Page-citation jumps continue to use
  the existing machinery unchanged (campaign: "page citations still jump the
  book"): the citation `[Page N]` pattern (`PAGE_CITE_PATTERN`,
  workbenchChat.ts:146) and whatever click handler WorkbenchTab already wires
  stay as-is — the desk re-hosts the surface, not the protocol.

---

## 5. The slide-underneath animation + scrim

### 5.1 Decision: `transform: translateY()`, not `clip-path`

- The sheet is a **fully painted opaque-ish surface** that enters with
  `transform: translateY(100%) → translateY(0)` over `top` (it rises from the
  bottom edge of the page area, i.e. it comes out from *underneath* the still-
  rendered book). Duration 240ms, easing `cubic-bezier(0.2, 0, 0, 1)` — the
  "catalogue drawer" slide.
- **`clip-path` was rejected**: it reveals content without motion parallax and
  forces compositor-unfriendly repaints on a scrollable sheet; `transform` is
  composited-only and is the property every existing transition in the chrome
  uses (chrome.css passim; `transition-[opacity,margin-top] duration-300` in
  HeaderBar.tsx:119).
- The "underneath" *feel* comes from the book staying put and dimming beneath
  the sheet's translucent scrim while the sheet rises — not from translating
  the book (translating `slideRef` would fight the pull-down/bookmark gesture
  machinery documented at BooksGrid.tsx:169-176).
- **Exit animation: none in D1** — close unmounts immediately (the store flips
  and the cell returns to the bare book). A 200ms exit slide was cut to keep
  the host's state machine trivial (one boolean); if dogfood asks, add a
  `isClosing` local state later. Documented as an open question (§11).

### 5.2 The scrim — ghost-visible book (non-negotiable 7)

The sheet root carries the scrim as its **own background layer**, a single
absolutely-positioned `.desk-scrim` div painted *behind* the sheet's content
but above the book (the sheet root is opaque-stacked over the book by z-[5]):

```css
/* apps/readest-app/src/app/reader/components/desk/desk.css */
.desk-sheet {
  background: transparent; /* the scrim paints the dim; content sits above it */
}
.desk-scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--paper) 82%, transparent);
  pointer-events: none; /* the book is dimmed, not dismissed — clicks land on the desk */
}
```

- **82% paper**: the page ghosts through at roughly one-fifth strength —
  enough to read *that* a page is there (source of truth, §8), dim enough that
  the sheet's ink dominates. (Tune 78–86% at the review gate; the value is
  one token in one place.)
- **Not a dismiss surface**: deliberately *unlike* the notebook's `Overlay`
  (Overlay.tsx onClick → onDismiss; Notebook.tsx:400-403). Clicking through
  the scrim hits the sheet stage, never dismisses; only Esc and the header
  toggle dismiss. E-ink: add `[data-eink='true'] .desk-scrim { background:
  var(--paper); }` — the eink rule elsewhere flattens translucency the same
  way (chrome.css:162-164).

### 5.3 `desk.css` — the full new file (unlayered, `desk-` prefix)

```css
/**
 * The Desk — sheet host (D1). Antiquarian Catalogue: paper surfaces, 1px ink
 * hairlines, ≤2px radius, stamp the only accent, light mode, unlayered CSS
 * (mirrors chrome.css conventions). Canvas/composer/rail classes from later
 * lanes also live here, prefixed desk-.
 */

/* ---------- the sheet ---------- */
.desk-sheet {
  border-radius: 2px;
  transform: translateY(100%);
  transition: transform 240ms cubic-bezier(0.2, 0, 0, 1);
  box-shadow: var(--lift-shadow);
}
/* entered state — applied after mount via requestAnimationFrame (§5.4) */
.desk-sheet.desk-sheet-open {
  transform: translateY(0);
}

/* ---------- the ghost-book scrim ---------- */
.desk-scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--paper) 82%, transparent);
  pointer-events: none;
}
[data-eink='true'] .desk-scrim {
  background: var(--paper);
}

/* ---------- chrome inside the sheet ---------- */
.desk-head {
  background: var(--paper-light);
}
.desk-stage {
  background: transparent;
  scrollbar-width: thin;
}

/* ---------- focus ---------- */
.desk-sheet :focus-visible {
  outline: 2px solid var(--stamp);
  outline-offset: 2px;
}

/* ---------- reduced motion ---------- */
@media (prefers-reduced-motion: reduce) {
  .desk-sheet {
    transition: none;
    transform: none; /* no entry slide; the sheet appears in place */
  }
}
```

(`.desk-head`/`.desk-stage` colors may collapse into the TSX via existing
Tailwind tokens — keep whichever the writer finds cleaner, but the classes
above are the contract other lanes cite.)

### 5.4 Entry animation mechanics

Because the sheet mounts with `isDeskVisible` already true, a mount-time
transition never runs. Pattern (no new hooks file needed):

```tsx
const [entered, setEntered] = React.useState(false);
useEffect(() => {
  if (!isDeskVisible) return;
  const raf = requestAnimationFrame(() => setEntered(true));
  return () => cancelAnimationFrame(raf);
}, [isDeskVisible]);
// root className: clsx('desk-sheet paper-bg', entered && 'desk-sheet-open', …)
```

---

## 6. Focus, Escape, and z-order

### 6.1 Escape

`useShortcuts({ onEscape: handleDismiss }, [handleDismiss])` — the same hook
`Notebook.tsx:133` uses. Its input guard (useShortcuts.ts:31-36) means
Escape while typing in the composer textarea does **not** dismiss (it returns
early for `INPUT`/`TEXTAREA`/contentEditable focus); Escape anywhere else
closes the desk. No new global keydown listeners.

### 6.2 Focus trap + focus return (non-negotiable 8)

Minimal, dependency-free trap (no existing trap precedent in the codebase):

- **On open**: focus moves to `[data-desk-initial-focus]` (the sheet's close
  button — §4.1).
- **Tab cycling**: a `keydown` handler on `sheetRef` intercepts `Tab`;
  collecting `sheet.querySelectorAll('button, [href], input, textarea,
  select, [tabindex]:not([tabindex="-1"])')` each press, it moves focus to the
  first element when Tab leaves the last (Shift+Tab wraps backwards). If the
  collection is empty, focus stays on the sheet root (`tabIndex={-1}` on the
  root as the ultimate fallback).
- **On close**: the cleanup of the open-effect returns focus to
  `useDeskStore.getState().toggleElement` (registered by DeskToggler, §3),
  falling back to `document.activeElement` captured at open. **This is the
  "Esc returns to the book with page intact" gate**: focus lands on the
  header toggle; the book never unmounted, its page state untouched.
- **Why not inert the book**: the FoliateViewer iframe is a separate document
  and already unreachable by tab order from the chrome layer; adding `inert`
  to `slideRef` would fight the page-turn snapshot machinery. The cycle trap
  suffices.

### 6.3 Z-order (amends the Reader.tsx:29-46 guide)

| Layer | z | Element |
|---|---|---|
| Dialogs/popups | 50 | unchanged |
| Professor bubbles | 50 | `ProfOverlay.tsx:106,173` — above the desk, speaks over it |
| Professor scrim | 40 | `ProfOverlay.tsx:103` |
| TTS bar / control | 40/30 | unchanged |
| Notebook unpinned | 45 | **above the desk — if the user opens the notebook over the desk it floats; the desk stays put beneath (both readable, no fight)** |
| Notebook pinned / header / footer | 20/10 | header stays **live above the desk** so the toggle works |
| **Desk sheet** | **5** | **new layer: above the book page area, below all chrome** |
| Book page area | 0 | unchanged, ghost-visible through the scrim |

Single focus owner in practice: the desk is a modal dialog (`aria-modal`),
the notebook's workbench tab is gone (§7), and opening the desk from another
book's cell first switches `sideBarBookKey` (DeskToggler, §3). The pinned
notebook coexisting above the desk is acceptable — notes about the desk are a
feature, not a split brain (the transcript lives only on the desk now).

Add one line to the Reader.tsx z-index comment block: `5 – Desk Sheet • the
workbench's full-page surface over the page area, below all chrome.`

---

## 7. Removing the Workbench tab (constitution product default 1 — binding)

### 7.1 `notebookStore.ts`

```diff
-export type NotebookTab = 'spine' | 'notes' | 'study' | 'workbench';
+export type NotebookTab = 'spine' | 'notes' | 'study';
```
Nothing else in the store changes — no workbench-specific state ever lived
here.

### 7.2 `NotebookTabNavigation.tsx`

- Delete `'workbench'` from the `tabs` array (NotebookTabNavigation.tsx:25).
- Delete the `case 'workbench': return _('Workbench');` arm of
  `getTabLabel` and the entire `case 'workbench':` arm of `getTabIcon`,
  including the inline pencil-over-ruled-paper SVG (lines ~46-70).
- The comment block above `tabs` (lines 19-24) gets one clause appended:
  "The workbench surface moved to the Desk (D1); the tab is gone
  (campaign default 1)."

### 7.3 `Notebook.tsx`

- **Delete**: the `const WorkbenchTab = lazy(() => import('./WorkbenchTab'));`
  line (Notebook.tsx:48), the `WorkbenchFallback` component (52-62), the
  `DeskErrorBoundary` class (~65-84), and the render branch
  `notebookActiveTab === 'workbench' ? (…) :` (Notebook.tsx:505-511, collapsing the ternary
  chain so `study` falls through to the notes/empty branches as before).
- **Guard the persisted tab** (Notebook.tsx:150-152): settings from older
  builds may contain `notebookActiveTab: 'workbench'`. Change:
  ```tsx
  if (settings.globalReadSettings.notebookActiveTab) {
    setNotebookActiveTab(settings.globalReadSettings.notebookActiveTab);
  }
  ```
  to
  ```tsx
  const savedTab = settings.globalReadSettings.notebookActiveTab;
  if (savedTab === 'spine' || savedTab === 'notes' || savedTab === 'study') {
    setNotebookActiveTab(savedTab);
  }
  ```
  (TS narrows the old union fine at the boundary; the runtime guard keeps a
  stale persisted value from landing in the now-typed state and rendering a
  dead branch.) Same guard in `handleTabChange` is unnecessary — its only
  callers are the three surviving tabs.

### 7.4 What happens to the lazy import and `WorkbenchTab.tsx` itself

**It moves, verbatim, into DeskSheet.tsx** (§4.1): `lazy(() =>
import('../notebook/WorkbenchTab'))`, the `DeskErrorBoundary` class (renamed
in place — it was already called *Desk*ErrorBoundary), and the quiet-paper
fallback with its existing string `_('This desk is being restored.')`. The
2026-09-06 crash-isolation lesson (Notebook.tsx:25-31 comment) is preserved
exactly: a workbench crash seals behind paper and never takes the reader down.
`WorkbenchTab.tsx`, `workbenchChat.ts`, the services layer, and
`workbench-transcript.json` persistence are **untouched** — the Desk is a
renderer + composer change, not a protocol change (vision; campaign carried
contracts). `WorkbenchTab.css` stays where it is (imported by WorkbenchTab);
canvas lanes will add `desk-` sheet classes to `desk.css`, not to it.

### 7.5 The removed `_()` strings

`_('Workbench')` (tab label) is deleted with the tab. It must also be removed
from any locale tables the project maintains, per the project's i18n hygiene.

---

## 8. "The book stays visible as source of truth" — concrete meaning in D1

1. **Ghost visibility**: the book is never unmounted, hidden, or navigated
   when the desk opens. It is dimmed to ~18% strength through
   `.desk-scrim` (§5.2) — a reader can still see the page's typographic mass
   behind the sheet, so the book reads as the bedrock the desk rests on.
2. **The address stays on screen**: the sheet's own header prints the book
   title and current 1-based page (`progress.page`, §4.1) — the reader always
   knows *where in the book* the sitting happens.
3. **Citations still jump**: `[Page N]` citations in professor blocks keep
   their existing click-to-jump behavior (machinery unchanged, campaign
   contract); jumping the page while the desk is open is legal and does not
   dismiss the desk — the ghost page updates behind the scrim.
4. **Dismissal is lossless**: Esc or the toggle returns to the exact same
   page, selection state untouched (nothing in the close path touches the
   view; focus return lands on the toggle, §6.2).
5. **Context stays tiered**: the T0–T4 book pack rebuilt every turn
   (`workbenchSession.ts`, cited at WorkbenchTab.tsx:17-22) is unchanged — the
   professor still cites only the pack's page whitelist. Moving the surface
   moved nothing about grounding.

---

## 9. `_()` string table (D1 adds exactly these)

| String | Where | Notes |
|---|---|---|
| `_('Open the Desk')` | DeskToggler aria-label | Librarian voice; "the Desk" as a proper noun, matching the vision. |
| `_('Close the Desk')` | DeskToggler aria-label + sheet close button | Flips with state. |
| `_('The Desk')` | DeskSheet `aria-label` | Names the dialog for screen readers. |
| `_('Page {{page}}')` | DeskSheet header page chip | Interpolated; fallback noted in §4.1 if the helper lacks params. |
| `_('This desk is being restored.')` | DeskFallback | **Reused verbatim** from Notebook.tsx:43 — do not reword; the string already exists. |

Removed: `_('Workbench')` (§7.5). Nothing machinery-flavored ("overlay",
"panel", "modal", "session") may appear in user-facing copy.

---

## 10. Tests

Two new files, jsdom, plain vitest (no browser lane). Store test first —
component test stubs the stores it touches.

### 10.1 `apps/readest-app/src/__tests__/reader/desk-store.test.ts`

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useDeskStore } from '@/store/deskStore';

beforeEach(() => {
  useDeskStore.setState({ isDeskVisible: false, toggleElement: null });
});

describe('deskStore', () => {
  test('starts closed', () => {
    expect(useDeskStore.getState().isDeskVisible).toBe(false);
    expect(useDeskStore.getState().getIsDeskVisible()).toBe(false);
  });

  test('toggleDesk opens, toggleDesk again closes', () => {
    useDeskStore.getState().toggleDesk();
    expect(useDeskStore.getState().isDeskVisible).toBe(true);
    useDeskStore.getState().toggleDesk();
    expect(useDeskStore.getState().isDeskVisible).toBe(false);
  });

  test('setDeskVisible is idempotent and absolute', () => {
    const listener = vi.fn();
    const unsub = useDeskStore.subscribe(listener);
    useDeskStore.getState().setDeskVisible(true);
    useDeskStore.getState().setDeskVisible(true); // no spurious notification
    expect(useDeskStore.getState().isDeskVisible).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    useDeskStore.getState().setDeskVisible(false);
    expect(useDeskStore.getState().isDeskVisible).toBe(false);
    unsub();
  });

  test('toggleElement registers and clears for focus return', () => {
    const el = document.createElement('span');
    useDeskStore.getState().setToggleElement(el);
    expect(useDeskStore.getState().toggleElement).toBe(el);
    useDeskStore.getState().setToggleElement(null);
    expect(useDeskStore.getState().toggleElement).toBeNull();
  });
});
```

### 10.2 `apps/readest-app/src/__tests__/reader/desk-sheet.test.ts`

Component test with `@testing-library/react`; stub `useReaderStore`,
`useBookDataStore`, and the lazy `WorkbenchTab` (vi.mock the
`../notebook/WorkbenchTab` import to a trivial div) so the test never pulls
KaTeX/Streamdown. `useShortcuts` runs its real window listener — fire real
`keydown` events on `window`. `vi.mock('@/hooks/useResponsiveSize', …)` where
needed by the toggler.

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import DeskSheet from '@/app/reader/components/desk/DeskSheet';
import { useDeskStore } from '@/store/deskStore';
// …store stubs as described above…

beforeEach(() => {
  cleanup();
  useDeskStore.setState({ isDeskVisible: false, toggleElement: null });
});

describe('DeskSheet host', () => {
  test('renders nothing while the store is closed', () => {
    render(<DeskSheet bookKey='book-1' />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('store-driven open mounts the dialog with book title and page', () => {
    useDeskStore.getState().setDeskVisible(true);
    render(<DeskSheet bookKey='book-1' />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('The Book Title')).toBeTruthy();   // from stubbed getBookData
    expect(screen.getByText(/Page 42/)).toBeTruthy();          // from stubbed getProgress
  });

  test('toggle idempotency: two opens in one tick leave one sheet mounted', () => {
    useDeskStore.getState().setDeskVisible(true);
    useDeskStore.getState().setDeskVisible(true);
    render(<DeskSheet bookKey='book-1' />);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  test('Escape dismisses and returns focus to the registered toggle', () => {
    const toggle = document.createElement('button');
    document.body.appendChild(toggle);
    toggle.focus();
    useDeskStore.getState().setToggleElement(toggle);
    useDeskStore.getState().setDeskVisible(true);
    render(<DeskSheet bookKey='book-1' />);
    // sanity: focus moved into the sheet on open
    expect(toggle).not.toHaveFocus?.() ?? expect(document.activeElement).not.toBe(toggle);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDeskStore.getState().isDeskVisible).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle); // Esc returns to the book chrome
    toggle.remove();
  });

  test('Escape inside a textarea does NOT dismiss (composer safety)', () => {
    useDeskStore.getState().setDeskVisible(true);
    render(<DeskSheet bookKey='book-1' />);
    const composer = screen.getByTestId('stub-composer-textarea'); // stubbed WorkbenchTab textarea
    composer.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDeskStore.getState().isDeskVisible).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('focus trap cycles Tab within the sheet', () => {
    useDeskStore.getState().setDeskVisible(true);
    render(<DeskSheet bookKey='book-1' />);
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])');
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
  });

  test('close button dismisses via the same setDeskVisible path', () => {
    useDeskStore.getState().setDeskVisible(true);
    render(<DeskSheet bookKey='book-1' />);
    fireEvent.click(screen.getByLabelText('Close the Desk'));
    expect(useDeskStore.getState().isDeskVisible).toBe(false);
  });
});
```

(Adjust `toHaveFocus` usage to the project's matcher setup; the semantic
assertions — dialog present/absent, focus target, store value — are the
contract. The stubbed WorkbenchTab must render one `<textarea
data-testid='stub-composer-textarea'>` so the composer-safety case has a real
input to focus.)

---

## 11. Open questions (for the owner / review gate)

1. **Exit animation**: D1 unmounts instantly on close (§5.1). A 200ms exit
   slide is cheap to add later behind a local `isClosing` state — dogfood call.
2. **Scrim opacity**: 82% paper is specced as a single token; the review gate
   should look at it on a real book with marginalia-dense pages (target:
   page's line rhythm ghost-visible, not readable).
3. **Notebook-over-desk coexistence**: the pinned notebook floats above the
   desk (z-20 > z-5). If dogfood reads that as split-brain, the alternative is
   desk-open auto-hides the unpinned notebook and vice versa — deferred; the
   transcript no longer lives in the notebook so the conflict surface is small.
4. **Mobile**: on phones the desk takes the cell's full area including where
   the header was — acceptable for v1 (the header is hover/tap-gated there
   anyway); the sheet's own close button carries mobile.
5. **`_('Page {{page}}')` interpolation**: confirm `useTranslation`'s param
   support at write time; fallback is concatenation (§4.1).
