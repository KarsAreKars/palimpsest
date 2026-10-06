# HPUB hell harness (r4 corpus, promoted per K8 / r5 ruling E4)

Synthesized nasty-PDF generator + runner that defines "reads" without a
human (docs/research/HPUB_HELL_CORPUS.md). Lives beside the pipeline it
tests; the generated corpus and run artifacts are NOT committed
(`.gitignore`) — regenerate deterministically (<1 s, seed 42):

```sh
VENV=~/Library/Application\ Support/com.bilingify.readest/hpub-venv/bin/python
"$VENV" hellgen.py all                                   # corpus/ (12 cases)
"$VENV" run_harness.py --fast                            # all non-nightly rows
"$VENV" run_harness.py                                   # full matrix incl. nightly
"$VENV" run_harness.py --case sanity-5p                  # one row
"$VENV" -m unittest test_error_envelope test_acquire_wrapper -v   # unit tests
```

Everything runs hermetic: `HF_HUB_OFFLINE=1` is forced by run_case.py, the
venv python is used for the sidecar, and a per-case subprocess timeout is a
failure (I1: a hang is a red row, full stop). `HPUB_VENV_PYTHON` overrides
the venv path.

- `hellgen.py` — hand-rolled-PDF generator; 12 cases each named by tier +
  receipt (I6). `case.json` pins expectations; T2/T3 rows pin today's
  behavior and are flipped by those waves (lying-cmap is red ON PURPOSE
  until T2).
- `run_case.py` — per-case executor; asserts M1 gate metrics, M2 manifest
  invariants (i3_*/i4_*), M3 grounding, and wall-clock budgets
  (i1_no_timeout / i1_wall_budget / i1_per_page_wall — bounded time scaled
  to page count).
- `run_harness.py` — matrix runner; writes runs/matrix.{md,json}; exit 1 iff
  any row is red.
- `golden/sanity-5p.content.md` — the byte-identity gate: the full-lane
  content.md of the most boring case. Every wave diffs it.
