# Phase 3 — Implementation Progress

## B-021 — Cherry-pick and semantic repair crash-safe

Status: completed.

Root cause confirmed: `IntegrationAgent` held applied child commits only in local arrays. A restart after a successful cherry-pick but before result persistence re-issued the same cherry-pick, with no durable record or commit-graph reconciliation.

Design applied: `JsonIntegrationOperationJournal` persists the immutable ordered child list, operation/attempt/lease identity, worktree/base descriptor, per-child state, Git result SHA and terminal disposition. Before every new cherry-pick, the agent reads `HEAD`, verifies whether the child commit is already an ancestor, and adopts it when it is. An interrupted `CHERRY_PICK_HEAD` is recorded with unmerged-path evidence and aborted before retrying from the safe boundary. The production execution host creates the journal under the run directory and supplies its operation lease identity to the integration node.

State/protocol: `prepared -> cherry_pick_started -> child_applied`; conflicts are recorded as `conflict_detected`; a clean terminal integration is `completed`. The journal rejects a resume whose immutable child list differs from the original operation.

Files modified:

- `packages/execution-core/src/integration/operation-journal.ts`
- `packages/execution-core/src/integration/agent.ts`
- `packages/execution-core/src/git/runner.ts`
- `packages/execution-core/src/run/executor.ts`
- `packages/execution-core/src/index.ts`
- `apps/web/src/lib/server/runs/execution-host.ts`
- `tests/helpers/fake-git-runner.ts`
- `tests/execution-core-integration.test.ts`

Regression evidence: before the implementation, the new resume regression failed with `expected ['SHA_A', 'SHA_B'] to deeply equal ['SHA_B']`; after it, it passes and verifies that only `SHA_B` is cherry-picked.

Commands/results:

- `corepack pnpm exec vitest run tests/execution-core-integration.test.ts --retry=0 --maxWorkers=1 --minWorkers=1 --silent` — red: 1 failed/23 passed; green: 24/24 passed.
- `corepack pnpm exec vitest run tests/execution-core-integration.test.ts tests/execution-core-run-executor.test.ts --retry=0 --maxWorkers=1 --minWorkers=1 --silent` — 56/56 passed.
- `corepack pnpm -F @manyhands/execution-core typecheck` — passed.
- `corepack pnpm --filter @manyhands/web exec tsc --noEmit` — passed.

Acceptance covered: repeated valid child cherry-picks are prevented by real commit-graph evidence; the child order is immutable on resume; interrupted Git state is explicitly inspected before new mutation; no external executor is invoked in tests.

Risks/deferred: recovery-center visualization and a broader operator UI remain Phase 4. The existing canonical trace event stream is retained; this task does not create a second event bus.

## B-022 — Safe, explicit and idempotent delivery

Status: completed.

Root cause confirmed: the legacy merge action used whichever branch was currently checked out after only a dirty-tree check. It did not bind the user confirmation to a manifest, target HEAD, target fingerprint, request version or durable receipt.

Design applied: the delivery panel now submits the displayed target branch, HEAD, clean state, manifest/final SHA, target fingerprint, expected run version and a stable idempotency key. `deliverRunBranch` validates all of them under the repository lease, persists a receipt before applying the merge, verifies/adopts an already-reachable final SHA on retry, and persists the completed receipt afterwards. An incomplete legacy merge request is rejected rather than silently using the current branch. Patch export remains a non-mutating artifact path.

Protocol: `prepared receipt -> preflight -> merge -> verified receipt`; branch/HEAD/dirty/fingerprint mismatch is a conflict with no mutation. A completed receipt is returned unchanged for the same idempotency key.

Files modified:

- `apps/web/src/lib/server/runs/delivery.ts`
- `apps/web/src/app/api/runs/[id]/deliver/route.ts`
- `apps/web/src/app/runs/[runId]/_components/delivery-panel.client.tsx`
- `tests/delivery-operation.test.ts`
- `docs/implementation-progress-phase-3.md`

Tests and commands:

- `corepack pnpm exec vitest run tests/delivery-operation.test.ts tests/deliver-route-guard.test.ts --retry=0 --maxWorkers=1 --minWorkers=1 --silent` — 6/6 passed.
- `corepack pnpm --filter @manyhands/web exec tsc --noEmit` — passed.

Acceptance covered: delivery mutates only the confirmed branch/HEAD; a receipt survives the side effect boundary; retry does not add a second merge; lifecycle and active-runner guards remain enforced. Deferred: richer receipt history/recovery UI belongs to B-025+.

## B-023 — Isolated worktree dependencies

Status: completed.

Root cause confirmed: `WorktreeManager.create()` linked the source checkout's writable `node_modules` into every worktree. That broke isolation even though Git worktrees themselves were separate.

Design applied: worktree provisioning no longer creates dependency symlinks/junctions. Dependency installation remains a subprocess supervised by the existing ProcessSupervisor and now writes a worktree-local `DependencyEnvironmentDescriptor` containing package manager, lockfile hash, runtime, status and timestamp. A failed install is recorded as failed, never ready; worktree cleanup removes its own descriptor and dependencies with the worktree.

Files modified:

- `packages/execution-core/src/worktree/manager.ts`
- `packages/execution-core/src/validation/dependencies.ts`
- `tests/worktree-dependency-isolation.test.ts`
- `docs/implementation-progress-phase-3.md`

Tests and commands:

- `corepack pnpm exec vitest run tests/worktree-dependency-isolation.test.ts tests/execution-core-worktree.test.ts tests/execution-core-dependency-installer.test.ts tests/process-supervisor.test.ts --retry=0 --maxWorkers=1 --minWorkers=1 --silent` — 25/25 passed.
- `corepack pnpm -F @manyhands/execution-core typecheck` — passed.

Acceptance covered: a real temporary source `node_modules` is not linked into its created worktree; installers run in the worktree and remain supervised. Deferred: shared content-addressable package-manager cache optimization is intentionally not introduced.

## B-024 — Validation, budgets and supervised process output

Status: completed.

Root cause confirmed: executor, validation and installer subprocesses accumulated output in unbounded strings. A noisy command could grow memory and persistence payloads without a deterministic tail, even though process cancellation and timeouts were already supervised.

Design applied: `BoundedOutput` preserves the newest diagnostic tail and observed-byte/truncation evidence while capping retained text. It is used by executor process capture, validation command capture/aggregation and dependency installation. Execution config now has effective defaults for output bytes, validation command count and install duration, alongside existing executor/integration budgets. Validation remains a separate fact: no validation commands remains unverified in the terminal artifact path; executor exit zero is not converted to validation pass.

Files modified:

- `packages/execution-core/src/executor/bounded-output.ts`
- `packages/execution-core/src/executor/process.ts`
- `packages/execution-core/src/validation/runner.ts`
- `packages/execution-core/src/validation/dependencies.ts`
- `packages/execution-core/src/types.ts`
- `packages/execution-core/src/index.ts`
- `tests/bounded-output.test.ts`
- `docs/implementation-progress-phase-3.md`

Tests and commands:

- `corepack pnpm exec vitest run tests/bounded-output.test.ts tests/execution-core-validation-runner.test.ts tests/execution-core-dependency-installer.test.ts tests/process-supervisor.test.ts --retry=0 --maxWorkers=1 --minWorkers=1 --silent` — 30/30 passed across the directed invocations.
- `corepack pnpm -F @manyhands/execution-core typecheck` — passed.
- `corepack pnpm --filter @manyhands/web exec tsc --noEmit` — passed.

Acceptance covered: retained subprocess output is bounded and carries truncation evidence; validation timeout/cancel remains a non-success outcome under ProcessSupervisor; executor and validation outcomes remain distinct. Deferred: Phase 4 recovery UI and Phase 5 telemetry aggregation are not introduced.

## Final verification

- Directed Phase 3 plus affected B-001–B-020 matrix: 15 files, 96 tests passed (`EXIT_CODE=0`).
- Package typechecks: 12/12 passed (`EXIT_CODE=0`). Web TypeScript typecheck passed (`EXIT_CODE=0`).
- `pnpm web:build`: first run exposed two unused B-015-era symbols in `execution-pipeline.ts`; they were removed without behavior change. The rerun built all packages and Next.js successfully (`EXIT_CODE=0`).
- Global hermetic suite: 170 files/1460 tests passed, 1 opt-in real-executor file skipped (2 tests), plus one Windows/POSIX kill verification skip. One failure remained: `tests/repo-lock-atomic.test.ts` reported two winners in its stale-lock contention loop during the global parallel workload; an immediate isolated run passed all 13 tests. This is classified as a reproducible-under-load B-004 race/flaky failure, not hidden or retried to claim a green suite. It predates Phase 3 files and requires a dedicated B-004 concurrency correction before a fully green global baseline can be claimed.

No B-025 or later feature was implemented.
