import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import DeskSheet from '@/app/reader/components/desk/DeskSheet';
import { useDeskStore } from '@/store/deskStore';

// Store stubs: the sheet reads the book + progress from the reader stores;
// keep the fixtures tiny and deterministic.
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ getProgress: () => ({ page: 42 }) }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({
      book: { title: 'The Book Title' },
      bookDoc: { metadata: { language: 'en' } },
    }),
  }),
}));

// The stage body is DeskCanvas (wave 3); stub it so the test never pulls
// KaTeX/Streamdown. It renders one textarea so the composer-safety case
// has a real input to focus.
vi.mock('@/app/reader/components/desk/DeskCanvas', () => ({
  default: () => React.createElement('textarea', { 'data-testid': 'stub-composer-textarea' }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

// Interpolating stub: _('Page {{page}}', { page: 42 }) -> 'Page 42'; every
// other key passes through verbatim.
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, options: Record<string, string | number> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? '')),
}));

beforeEach(() => {
  cleanup();
  useDeskStore.setState({ isDeskVisible: false, toggleElement: null });
  document.body.replaceChildren();
});

describe('DeskSheet host', () => {
  test('renders nothing while the store is closed', () => {
    render(React.createElement(DeskSheet, { bookKey: 'book-1' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('store-driven open mounts the dialog with book title and page', () => {
    useDeskStore.getState().setDeskVisible(true);
    render(React.createElement(DeskSheet, { bookKey: 'book-1' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('The Book Title')).toBeTruthy(); // from stubbed getBookData
    expect(screen.getByText(/Page 42/)).toBeTruthy(); // from stubbed getProgress
  });

  test('toggle idempotency: two opens in one tick leave one sheet mounted', () => {
    useDeskStore.getState().setDeskVisible(true);
    useDeskStore.getState().setDeskVisible(true);
    render(React.createElement(DeskSheet, { bookKey: 'book-1' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  test('Escape dismisses and returns focus to the registered toggle', () => {
    const toggle = document.createElement('button');
    document.body.appendChild(toggle);
    toggle.focus();
    useDeskStore.getState().setToggleElement(toggle);
    useDeskStore.getState().setDeskVisible(true);
    render(React.createElement(DeskSheet, { bookKey: 'book-1' }));
    // sanity: focus moved into the sheet on open
    expect(document.activeElement).not.toBe(toggle);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDeskStore.getState().isDeskVisible).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle); // Esc returns to the book chrome
    toggle.remove();
  });

  test('Escape inside a textarea does NOT dismiss (composer safety)', async () => {
    useDeskStore.getState().setDeskVisible(true);
    render(React.createElement(DeskSheet, { bookKey: 'book-1' }));
    const composer = await screen.findByTestId('stub-composer-textarea'); // stubbed stage textarea
    composer.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDeskStore.getState().isDeskVisible).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('focus trap cycles Tab within the sheet', async () => {
    useDeskStore.getState().setDeskVisible(true);
    render(React.createElement(DeskSheet, { bookKey: 'book-1' }));
    const dialog = screen.getByRole('dialog');
    await screen.findByTestId('stub-composer-textarea');
    const focusables = dialog.querySelectorAll(
      'button, input, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
  });

  test('close button dismisses via the same setDeskVisible path', () => {
    useDeskStore.getState().setDeskVisible(true);
    render(React.createElement(DeskSheet, { bookKey: 'book-1' }));
    fireEvent.click(screen.getByLabelText('Close the Desk'));
    expect(useDeskStore.getState().isDeskVisible).toBe(false);
  });
});
