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
  // Idempotent and absolute (Esc, close button, overlay paths): repeat sets
  // of the same value return the identical state reference so zustand skips
  // the notification entirely.
  setDeskVisible: (visible: boolean) =>
    set((state) => (state.isDeskVisible === visible ? state : { isDeskVisible: visible })),
  setToggleElement: (el) => set({ toggleElement: el }),
}));
