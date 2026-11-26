/**
 * The professor ask bridge — one window event, any surface can ask.
 *
 * Extracted from StudyTab (Wave A2) so non-component code (the guided
 * session store) can ask without importing a React surface. useProfessor
 * owns the loop: it listens for PROF_ASK_EVENT and runs the ordinary
 * professor exchange — context pack, streaming answer, ink, the ledger.
 *
 * Options:
 *   - system:  a system-prompt override (guided sessions compose the
 *     persona with the session doctrine — prompt.ts).
 *   - silent:  text-to-text. The answer streams and lands, but the voice
 *     stays silent. Guided mode defaults to silent; the speaker toggle
 *     opts back in. Absent = the voice speaks, as always.
 *   - onAnswer: called once with the completed answer — the cleaned prose
 *     and the FULL parsed annotation list (before the ink filter drops
 *     concept/qkind tags) — so a driving surface (the guided session)
 *     reads the verdict straight off the answer, in order, with no bus
 *     race. Absent = nothing changes.
 *   - onError:  called when the stream fails (barge-in aborts never
 *     fire it) — a driving surface can say so instead of hanging.
 */
import type { ProfessorAnnotation } from './annotations';

export const PROF_ASK_EVENT = 'palimpsest-prof-ask';

export interface ProfAskOptions {
  system?: string;
  silent?: boolean;
  onAnswer?: (text: string, annotations: ProfessorAnnotation[]) => void;
  onError?: (message: string) => void;
}

/** Fire a professor question from anywhere; useProfessor owns the loop. */
export const askProfessorFromUI = (
  bookKey: string,
  question: string,
  opts?: ProfAskOptions,
): void => {
  window.dispatchEvent(new CustomEvent(PROF_ASK_EVENT, { detail: { bookKey, question, ...opts } }));
};
