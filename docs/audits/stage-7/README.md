# Stage 7 / GA — Git-native artifacts and exact validation

## Candidate

Implementation candidate `69258337241b8828d0e75777f58ce0736d212b94`.

## Gate evidence

- Exact Git manifests represent binary blobs, executable modes and deletes;
  symlinks, gitlinks and out-of-contract paths reject deterministically.
- Exact materialization writes declared blob bytes without checkout/reset, so a
  repository smudge filter cannot execute.
- Run-owned refs retain candidates through `git gc`; identifier segments include
  a digest suffix and release requires a journal authorization bound to the
  exact ref and candidate.
- The canonical executor rejects commit artifacts before integration; integration
  no longer produces commit artifacts.
- Human review is bound to manifest/tree/rubric and becomes stale after a newer
  integration candidate, including across a real daemon restart and replay.
- The GA scenario combines a real binary/mode/delete manifest, GC retention,
  daemon journal adoption, review, restart and stale replacement.

## Commands and results

All ran with Node 22.22.0 and `--retry=0 --minWorkers=1 --maxWorkers=1`.

- Stage 7 artifact/fingerprint matrix: 48 passed.
- Exact validation/driver matrix: 78 passed.
- Daemon lifecycle plus GA scenario: 6 passed.
- `@manyhands/run-coordinator`, `@manyhands/daemon`, and
  `@manyhands/execution-core` typechecks: passed.
- `git -c core.whitespace=cr-at-eol diff --check`: passed.

## Limits

No live model, Stage 8 sandbox, Stage 9 parallel integration, delivery, thesis
or experiment work was performed.  The full monorepo suite was not used as GA
evidence because its host timeout is inconclusive; the bounded matrices above
are the gate evidence.
