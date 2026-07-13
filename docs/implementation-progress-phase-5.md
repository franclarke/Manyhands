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

## B-033 — Reproducible current documentation

- **Status:** completed.
- **Confirmed cause:** root and web READMEs still instructed operators to use
  Gemini, referenced a removed executor document, listed an obsolete pnpm
  version, and omitted the diagnostics API. Three system pages also retained
  Gemini-specific operational prose despite the active Claude/Codex runtime.
- **Applied design:** corrected only active product documentation: Claude Code
  is default, Codex is selectable, current `pnpm@11.7.0` commands are shown,
  the diagnostics endpoint is listed, and generic executor wording replaces
  stale Gemini-specific claims. Historical removals remain documented as
  history, not as active functionality.
- **Files modified:** `README.md`, `apps/web/README.md`,
  `docs/system/05-worktree-layer.md`, `07-context-and-scope.md`,
  `08-result-pipeline.md`, `tests/documentation-current.test.ts`, this ledger.
- **Test added:** documentation contract verifies active executors, current
  command presence, removed Gemini environment variable, and diagnostics API.
- **Red regression observed:** root README lacked `Codex CLI` and still named
  Gemini default (Vitest exit 1).
- **Verification:** documentation contract: 1/1 passed. A clean worktree/clone
  verification and full command matrix are recorded in the final Phase 5
  verification section below.
- **Acceptance verified:** docs describe implemented product behavior only;
  no Lab/replay workflow or Gemini executor is presented as active.
- **Risks / deferred:** historical references in fixtures and migration tests
  intentionally remain as legacy evidence; they are not product instructions.
- **Commit:** pending local commit.

## B-032 — Operational telemetry and retention diagnostics

- **Status:** completed.
- **Confirmed cause:** recovering an incident required manually locating the run
  record, event log and evidence directories; no bounded export correlated the
  operation lease with durable event and disk facts.
- **Applied design:** `buildRunDiagnostics` produces a metadata-only diagnostic
  record with run/operation/fencing/commit correlation, lifecycle state,
  canonical event-log health and event count, plus per-category run storage.
  The GET endpoint at `/api/runs/:id/diagnostics` exposes that redacted export
  with `no-store`. It reads no prompts, output tails, file content or secrets.
  Existing archive/purge retention policy remains authoritative.
- **Files modified:** `apps/web/src/lib/server/runs/diagnostics.ts`,
  `apps/web/src/app/api/runs/[id]/diagnostics/route.ts`,
  `tests/run-diagnostics.test.ts`, this ledger.
- **Test added:** a persisted operation lease and event log produce correlated
  disk diagnostics; an unrelated secret-containing file never appears.
- **Red regression observed:** missing diagnostics module (Vitest exit 1).
- **Verification:** diagnostics plus archive/purge: 8/8 passed.
- **Acceptance verified:** an operator can obtain correlated status and storage
  evidence without inspecting run files manually; retention remains conservative
  and explicit.
- **Risks / deferred:** diagnostics does not implement Phase 2 outbox/recovery
  adoption or a task-attempt journal. Disk quota enforcement is intentionally
  not added; this checkpoint reports categories so an operator can act safely.
- **Commit:** pending local commit.

## B-031 — Single executor registry and legacy containment

- **Status:** completed.
- **Confirmed cause:** `apps/web/src/lib/models.ts` duplicated executor and model
  descriptors already owned by `@manyhands/execution-core`; its copy drifted in
  usage-source and planning-capability values and still displayed disabled
  legacy OpenCode.
- **Applied design:** web imports the execution-core registry and projects only
  enabled descriptors for controls and request validation. Claude Code remains
  the default; Codex remains the alternative. The disabled legacy executor is
  retained only in the package registry for persisted-record compatibility and
  is not exposed by the application.
- **Files modified:** `apps/web/src/lib/models.ts`, `tests/model-registry.test.ts`, this ledger.
- **Tests adjusted:** registry tests now assert the two visible executors and
  source-of-truth capabilities; executor-selection tests cover Claude, Codex,
  and legacy model resolution.
- **Regression observed:** after replacing the duplicate, stale UI assertions
  expected `usage=unavailable` and planning capability for all Codex models;
  canonical registry returned `reported` for Claude and limits planning to
  `gpt-5.5` (Vitest exit 1).
- **Verification:** model registry + executor selection: 11/11 passed.
- **Acceptance verified:** no package imports from `apps`; only Claude Code and
  Codex are active/selectable product executors; disabled legacy configuration
  cannot be submitted through normal selection.
- **Risks / deferred:** migration of historical `gemini` strings remains the
  existing legacy parser path; no new migration system or event-store changes
  were introduced.
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
