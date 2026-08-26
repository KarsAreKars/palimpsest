/**
 * Professor annotation bus (HP-2).
 *
 * The professor's answer is parsed in useProfessor (React land); the marks
 * are drawn by ProfAnnotations onto foliate's per-page SVG overlayers
 * (foliate land, which calls redraw outside the React cycle). This tiny
 * pub/sub is the hand-off: one annotation set per book, replace-on-answer,
 * cleared on overlay close. Snapshots are referentially stable so
 * useSyncExternalStore doesn't loop.
 */
import type { ProfessorAnnotation } from './annotations';

export interface ProfessorAnnotationSet {
  /** 1-based PDF page the annotations belong to. */
  page: number;
  annotations: ProfessorAnnotation[];
  /** Pre-lap: true while the answer is still streaming — the pen draws the
   *  set faint so ink leads the voice; flipped false when the answer
   *  completes (the "strike"). */
  pending?: boolean;
}

type Listener = () => void;

const stateByBook = new Map<string, ProfessorAnnotationSet>();
const listeners = new Set<Listener>();

const emit = (): void => {
  for (const l of listeners) l();
};

export const setProfessorAnnotations = (bookKey: string, set: ProfessorAnnotationSet): void => {
  stateByBook.set(bookKey, set);
  emit();
};

export const clearProfessorAnnotations = (bookKey: string): void => {
  if (stateByBook.delete(bookKey)) emit();
};

export const getProfessorAnnotations = (bookKey: string): ProfessorAnnotationSet | null =>
  stateByBook.get(bookKey) ?? null;

export const subscribeProfessorAnnotations = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
