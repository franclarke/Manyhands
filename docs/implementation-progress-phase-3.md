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
