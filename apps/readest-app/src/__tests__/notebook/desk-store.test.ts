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
