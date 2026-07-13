# Implementation progress — Phase 5

This ledger records only Phase 5 work. Earlier phase evidence remains in its
respective progress documents.

## B-029 — Planning and repository-index budgets

- **Status:** completed.
- **Confirmed cause:** planning had no persisted effective budget; repository
  grounding traversed the target without `.gitignore`, symlink, byte, file, or
  cancellation limits; its process cache only keyed on `HEAD`.
- **Baseline:** no product performance claim is made for this checkpoint. The
  bounded index regression uses a real temporary filesystem tree.
- **Applied design:** `planningBudget` is a versioned RunRecord field normalized
  and persisted before planning side effects. The index consumes bounded,
  read-only limits, respects root `.gitignore`, rejects symlinks, reports
  omissions, observes `AbortSignal`, and fingerprints target, dirty state,
  schema, and budget. Recursive planner limits are routed to its existing
  concurrency/depth seams and reject child/call/prompt overages.
- **Files modified:** `apps/web/src/lib/server/runs/schema.ts`,
  `effective-planning-budget.ts`, `planning-pipeline.ts`, `planning-host.ts`,
  `repo-index-cache.ts`, `apps/web/src/lib/decomposer-policy.ts`,
  `packages/repository-index/src/index.ts`, and recursive decomposer adapters.
- **Tests added:** `tests/planning-budget.test.ts` covers effective defaults and
  fingerprint plus `.gitignore`, symlink and deterministic file-budget evidence.
- **Red regression observed:** `Cannot find module
  '@/lib/server/runs/effective-planning-budget'` (Vitest exit 1).
- **Verification:** targeted Vitest: 2/2 passed; repository-index and
  decomposer typechecks passed; rebuilt repository-index, decomposer and core;
  web typecheck completed without diagnostics.
- **Acceptance verified:** an effective budget is durable before the planning
  host is built; index omissions are visible and bounded; cache identity cannot
  reuse an index after a dirty-state or budget change; the planner receives
  explicit bounded settings.
- **Legacy compatibility:** missing `planningBudget` is normalized on first
  planning attempt; no persisted legacy field is removed.
- **Risks / deferred:** a single in-process planning semaphore and richer
  per-provider model-call accounting are not introduced because they would
  require a new cross-run scheduler seam. Phase 2+ attempt journals and
  recovery are not implemented.
- **Commit:** pending local commit.

## B-030 — Scalable events, risk and UI projection

- **Status:** completed for the identified product hot path.
- **Confirmed cause:** B-027 streamed batches but each reconnect still scanned
  the JSONL file from byte zero. A late resume on a large run therefore had a
  linear prefix cost even when the client only needed a few events.
- **Baseline:** the new real JSONL regression reads event 99,901 from a
  100,000-event log. Before the fix it completed the requested read but had no
  index (`indexed` was `undefined`); the first scan took 759 ms in the
  regression run.
- **Applied design:** the canonical event reader retains a sparse, stat-keyed
  offset cache every 256 events. A warm reconnect starts at the nearest durable
  sequence offset and keeps the same envelope/checksum/sequence verification.
  Cache invalidation is tied to log size and mtime; a cold or changed log safely
  falls back to byte zero. Existing reducer cursor idempotence and risk-aware
  scheduling remain unchanged.
- **Files modified:** `apps/web/src/lib/server/runs/run-model-event-log.ts`,
  `tests/durable-run-event-log.test.ts`, this ledger.
- **Tests added:** 100k event resume test checks exact suffix and that the
  second read uses the sparse index.
- **Red regression observed:** expected `indexed === true`, received
  `undefined` (Vitest exit 1).
- **Verification:** `durable-run-event-log` + SSE replay: 12/12 passed; the
  100k test passed in 357 ms after the change.
- **Acceptance verified:** reconnects no longer require a full prefix replay in
  a warm product process; event identity and validation stay canonical.
- **Risks / deferred:** this is an in-process sparse cache, not the Phase 2
  incremental-event-store/outbox work. Full graph virtualization was not added:
  the current UI already consumes the bounded incremental stream and no
  independently reproduced render hot spot justified a product rewrite.
- **Commit:** pending local commit.
