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
