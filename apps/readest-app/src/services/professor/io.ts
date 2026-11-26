/**
 * io — the one file-content decode shared by the professor's persistence
 * lanes and the desk/notebook readers (simplicity audit C1: this two-liner
 * was defined five times — learner.ts, learnerProfile.ts, pageLookup.ts,
 * StudyTab.tsx, useTranscriptPersistence.ts).
 */
export const toText = (c: string | ArrayBuffer): string =>
  typeof c === 'string' ? c : new TextDecoder().decode(c);
