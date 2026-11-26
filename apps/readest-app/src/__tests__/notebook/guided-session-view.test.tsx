/**
 * GuidedSessionView — the full-screen conversation (Wave A2). Pins:
 *   - hidden in free mode; a full-screen dialog in guided mode;
 *   - THE CONVERSATION RENDERS THE BEAT LOG IN ORDER — professor left,
 *     learner right, his turns through the Prose pipeline;
 *   - the header carries the goal and the route strip (one segment per
 *     concept on the road);
 *   - the composer is text-to-text: Enter sends, Shift+Enter breaks the
 *     line; the speaker toggle is the voice opt-in;
 *   - the exit returns to free mode (the desk), the session holding its
 *     place.
 *
 * The store is real (its controller is pinned in
 * professor-guided-session-store.test.ts); the professor bridge is
 * captured so a send can be simulated end to end.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, options: Record<string, string | number> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? '')),
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));
// The Prose pipeline (Streamdown + KaTeX) is pinned elsewhere; here a
// marker element proves the professor's turns route through it.
vi.mock('@/app/reader/components/notebook/wbShared', () => ({
  Prose: ({ text }: { text: string }) => <div data-testid='prose'>{text}</div>,
}));

const asks: { question: string; opts: { silent?: boolean } }[] = [];
vi.mock('@/services/professor/askBridge', () => ({
  askProfessorFromUI: (_bookKey: string, question: string, opts: { silent?: boolean }) => {
    asks.push({ question, opts });
  },
}));

import GuidedSessionView from '@/app/reader/components/notebook/GuidedSessionView';
import { useGuidedSessionStore } from '@/app/reader/components/notebook/guidedSessionStore';
import { idleSession, sessionReducer, type SessionEvent } from '@/services/professor/guidedSession';
import { planRoute } from '@/services/professor/planRoute';

const BK = 'bk';
const T = '2026-11-26T00:00:00Z';

const route = planRoute({
  goal: 'attention',
  conceptStates: {},
  seeds: [{ name: 'queries' }, { name: 'keys' }],
});

const walk = (...events: SessionEvent[]) => events.reduce(sessionReducer, idleSession());

/** A live teaching session with a short conversation in the log. */
const teachingState = () =>
  walk(
    { type: 'start', goal: 'attention' },
    { type: 'measured', stateRead: 'steady' },
    { type: 'planned', route },
    {
      type: 'beat',
      beat: { kind: 'note', speaker: 'professor', text: 'A guided session begins.', at: T },
    },
    {
      type: 'beat',
      beat: { kind: 'trial', speaker: 'professor', text: 'What does a query do?', at: T },
    },
    {
      type: 'beat',
      beat: { kind: 'note', speaker: 'learner', text: 'It looks things up.', at: T },
    },
    {
      type: 'beat',
      beat: {
        kind: 'verdict',
        speaker: 'professor',
        text: 'Exactly — a lookup.',
        verdict: 'pass',
        concept: 'queries',
        at: T,
      },
    },
  );

beforeEach(() => {
  cleanup();
  asks.length = 0;
  useGuidedSessionStore.getState().reset();
  useGuidedSessionStore.setState({ mode: 'free', voiceOn: false, bookKey: BK });
});

describe('the full-screen surface', () => {
  test('renders nothing in free mode', () => {
    render(<GuidedSessionView bookKey={BK} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('guided mode opens the full-screen dialog with the goal in the header', () => {
    useGuidedSessionStore.setState({ mode: 'guided', session: teachingState() });
    render(<GuidedSessionView bookKey={BK} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.className).toContain('inset-0'); // full-screen, not the side panel
    expect(screen.getByText('The road to attention')).toBeTruthy();
  });

  test('the route strip: one segment per concept on the road', () => {
    useGuidedSessionStore.setState({ mode: 'guided', session: teachingState() });
    const { container } = render(<GuidedSessionView bookKey={BK} />);
    expect(container.querySelectorAll('.gs-route-seg')).toHaveLength(3); // queries, keys, attention
    expect(container.querySelectorAll('.gs-route-current')).toHaveLength(1);
  });

  test('the start plate when idle: the goal input and Begin', () => {
    useGuidedSessionStore.setState({ mode: 'guided' });
    render(<GuidedSessionView bookKey={BK} />);
    expect(screen.getByLabelText('Session goal')).toBeTruthy();
    expect(screen.getByText('Begin')).toBeTruthy();
  });
});

describe('the conversation — the beat log, in order', () => {
  test('turns render in beat order; his turns use the Prose pipeline, yours are plain', () => {
    useGuidedSessionStore.setState({ mode: 'guided', session: teachingState() });
    const { container } = render(<GuidedSessionView bookKey={BK} />);
    const turnEls = Array.from(container.querySelectorAll('.gs-turn'));
    expect(turnEls).toHaveLength(4);
    const texts = turnEls.map((el) => el.textContent ?? '');
    expect(texts[0]).toContain('A guided session begins.');
    expect(texts[1]).toContain('What does a query do?');
    expect(texts[2]).toContain('It looks things up.');
    expect(texts[3]).toContain('Exactly — a lookup.');
    // Order is the log's order — nothing re-sorted.
    expect(texts.join('|')).toMatch(/begins.*query do.*looks things up.*Exactly — a lookup/s);
    // Sides: professor left, learner right.
    expect(turnEls[0]!.className).toContain('gs-turn-prof');
    expect(turnEls[2]!.className).toContain('gs-turn-learner');
    // His turns render through Prose; yours do not.
    expect(turnEls[1]!.querySelector('[data-testid="prose"]')).toBeTruthy();
    expect(turnEls[2]!.querySelector('[data-testid="prose"]')).toBeNull();
    // The verdict rides his turn.
    expect(turnEls[3]!.textContent).toContain('✓');
  });
});

describe('the composer — text-to-text', () => {
  test('Enter sends your answer through the store; the turn lands', () => {
    useGuidedSessionStore.setState({ mode: 'guided', session: teachingState() });
    render(<GuidedSessionView bookKey={BK} />);
    const input = screen.getByLabelText('Your answer');
    fireEvent.change(input, { target: { value: 'A key is what it matches.' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(asks).toHaveLength(1);
    expect(asks[0]!.question).toBe('A key is what it matches.');
    expect(asks[0]!.opts.silent).toBe(true); // voice off by default
    const turns = document.querySelectorAll('.gs-turn');
    expect(turns[turns.length - 1]!.textContent).toContain('A key is what it matches.');
  });

  test('Shift+Enter does not send', () => {
    useGuidedSessionStore.setState({ mode: 'guided', session: teachingState() });
    render(<GuidedSessionView bookKey={BK} />);
    const input = screen.getByLabelText('Your answer');
    fireEvent.change(input, { target: { value: 'line one' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(asks).toHaveLength(0);
  });

  test('the speaker toggle opts into voice for the next asks', () => {
    useGuidedSessionStore.setState({ mode: 'guided', session: teachingState() });
    render(<GuidedSessionView bookKey={BK} />);
    fireEvent.click(screen.getByLabelText('Hear the professor'));
    expect(useGuidedSessionStore.getState().voiceOn).toBe(true);
    const input = screen.getByLabelText('Your answer');
    fireEvent.change(input, { target: { value: 'spoken please' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(asks[0]!.opts.silent).toBe(false);
  });
});

describe('the exit — back to the desk', () => {
  test('the close control returns to free mode; the session holds its place', () => {
    useGuidedSessionStore.setState({ mode: 'guided', session: teachingState() });
    render(<GuidedSessionView bookKey={BK} />);
    fireEvent.click(screen.getByLabelText('Back to the desk'));
    expect(useGuidedSessionStore.getState().mode).toBe('free');
    expect(useGuidedSessionStore.getState().session.phase).toBe('teaching');
    expect(useGuidedSessionStore.getState().session.paused).toBe(true); // held, not lost
  });
});
