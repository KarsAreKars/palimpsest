/**
 * workbench-replay — the wiggly folio replay's pure predicates (d3 C1,
 * cases 8-9). The state machine itself is ephemeral UI over the persisted
 * folio; what the contract pins is the row-state mapping and the finale
 * (goal-frame) beat, testable without DOM.
 *
 * The r4 FIX 3 tail is DOM-bound: the replay's keydown guard must not
 * bubble to sheet/window-level shortcut listeners, so it renders the slip
 * with the same store/i18n stub idiom as desk-sheet.test.ts.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import {
  REPLAY_GOAL_CLASS,
  replayFramesGoal,
  replayRowState,
  default as DerivationSlip,
} from '@/app/reader/components/notebook/DerivationSlip';
import type { TranscriptBlock } from '@/app/reader/components/notebook/workbenchChat';

// Prose rides Streamdown/KaTeX — stub it so the DOM cases stay light
// (the desk-sheet.test.ts idiom).
vi.mock('@/app/reader/components/notebook/wbShared', () => ({
  Prose: ({ text }: { text: string }) => React.createElement('span', null, text),
  Slip: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
  VerdictChip: () => null,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, options: Record<string, string | number> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? '')),
}));

describe('replayRowState', () => {
  test('rows before the active step ghost, the active step lights, later rows hide', () => {
    expect(replayRowState(0, 0)).toBe('active');
    expect(replayRowState(0, 2)).toBe('ghost');
    expect(replayRowState(1, 2)).toBe('ghost');
    expect(replayRowState(2, 2)).toBe('active');
    expect(replayRowState(2, 1)).toBe('hidden');
    expect(replayRowState(3, 0)).toBe('hidden');
  });
});

describe('the goal beat', () => {
  test('replayFramesGoal is true only on the finale beat (active === total)', () => {
    const total = 3;
    expect(replayFramesGoal(3, total)).toBe(true);
    expect(replayFramesGoal(2, total)).toBe(false);
    expect(replayFramesGoal(0, total)).toBe(false);
    expect(replayFramesGoal(4, total)).toBe(false);
  });

  test('the finale frame class is pinned (the stamp-framed Q.E.D. gesture)', () => {
    expect(REPLAY_GOAL_CLASS).toBe('wb-replay-goal');
  });
});

describe('folio replay key scope (r4 FIX 3)', () => {
  const FOLIO_BLOCK: TranscriptBlock = {
    id: 'b1',
    author: 'professor',
    content: '$$a = b$$\nwhy\n$$b = c$$\nso',
    at: '2026-09-15T10:00:00Z',
    derivation: {
      steps: [
        { id: 'b1:0', latex: 'a = b', justification: 'why' },
        { id: 'b1:1', latex: 'b = c', justification: 'so' },
      ],
    },
  };

  beforeEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  test('replay Escape closes the replay without bubbling to an ancestor keydown listener', () => {
    // The spy sits on document.body — above the React root — mirroring the
    // sheet-level useShortcuts listener a bubbled keydown would reach.
    const ancestorSpy = vi.fn();
    document.body.addEventListener('keydown', ancestorSpy);
    const { container } = render(
      React.createElement(DerivationSlip, { block: FOLIO_BLOCK, ordinalBase: 0 }),
    );
    fireEvent.click(screen.getByText('Step through this folio'));
    const replay = container.querySelector('.wb-replay');
    expect(replay).not.toBeNull();

    fireEvent.keyDown(replay!, { key: 'Escape' });

    expect(ancestorSpy).not.toHaveBeenCalled(); // the guard: no bubble
    expect(container.querySelector('.wb-replay')).toBeNull(); // replay closed…
    expect(screen.getByText('Step through this folio')).toBeTruthy(); // …desk intact
  });

  test('replay arrow keys step through without bubbling to an ancestor keydown listener', () => {
    const ancestorSpy = vi.fn();
    document.body.addEventListener('keydown', ancestorSpy);
    const { container } = render(
      React.createElement(DerivationSlip, { block: FOLIO_BLOCK, ordinalBase: 0 }),
    );
    fireEvent.click(screen.getByText('Step through this folio'));
    const replay = container.querySelector('.wb-replay')!;

    fireEvent.keyDown(replay, { key: 'ArrowRight' });
    expect(ancestorSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Step 2 of 2')).toBeTruthy(); // advanced, not leaked

    fireEvent.keyDown(replay, { key: 'ArrowLeft' });
    expect(ancestorSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });
});
