# Integration smoke — the queen's Desk checklist

Run after wave 3 merges and `build_palimpsest.sh --bundle` + install succeeds.
App must be launched fresh; sidecar healthy (`engines.kokoro/math: true`).

1. **Sheet opens**: header lamp toggle → sheet rises from beneath; the book
   stays ghost-visible through the scrim; Esc closes and focus returns to the
   toggle; toggle again → sheet returns (state persists per book).
2. **Old transcript loads**: open the Attention book (has a 2.x transcript) →
   Desk shows the old sitting, blocks render, rail appears if a concept map
   exists; no console errors; sidebar notebook no longer has a Workbench tab.
3. **Click-to-place**: click the empty tail paper → floating composer;
   type a question; **Enter** → user block commits, professor streams IN
   PLACE below; scroll follows at 24px pin; no yank when scrolled up.
4. **Probe/teach-back still work**: say "I don't know" → muted chip, never
   graded; professor probes before teaching.
5. **Derivation + replay**: ask for a derivation → folio streams with
   per-step ✓/✗; the folio's step-through control reveals rows one at a
   time, ghost dimming, GOAL framed at the end; arrow keys work when focused;
   reduced-motion (macOS setting) shows all rows instantly.
6. **Guards**: ask for three figures in one turn → the third is muted with
   "The professor sets down his pen — one shape at a time."
7. **Rail**: concepts appear sage/muted/stamp; clicking a chip scrolls to its
   thread; shelves never jump more than one step after one exchange.
8. **Voice**: ▸ on a professor block speaks (Michael/Heart); starting
   narration while speaking → polite voice-busy notice; narration owns the
   ear; stopping narration allows playback again.
9. **Page consult**: ask which page defines a term → consult mark, then a
   citation only to a page actually read.
10. **Book integrity**: Esc → the book is exactly where it was (page,
    selection); the header lamp shows inactive; reader shortcuts unaffected.
11. **Chat-bridge**: in the professor overlay, trigger a deep-dive suggestion
    → "Take it to the desk" → Desk opens with the question seeded as the
    first user block, professor answers in place.
12. **Perf sanity**: a 200-block transcript scrolls without jank (content-
    visibility mitigation active if the gate tripped).

Any failure → fix before the review loop; do not waive P0s.
