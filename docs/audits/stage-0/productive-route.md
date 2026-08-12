# Stage 0 productive-route characterization

## Purpose and claim boundary

This document freezes the productive route that existed when Stage 0 began. It
is a characterization of current source, not evidence that the target
architecture is implemented. The target remains
[`docs/plans/2026-08-12-correctness-first-system-redesign.md`](../../plans/2026-08-12-correctness-first-system-redesign.md),
especially Stage 0 and Gate G0.

The route starts at `POST /api/runs`, crosses planning, scheduling, execution,
integration and validation, prepares one final candidate, and publishes it only
after a separate delivery command. Current source has useful correctness
foundations, but long-running work is still owned by the Next.js process and
several legacy representations remain on the productive path.

Candidate SHA, dirty-worktree inventory, platform and tool versions belong to
the Stage 0 environment record. Every test result cited as evidence must bind to
that exact candidate. This document does not infer a pass from a test filename
or from the existence of an implementation.

## Evidence levels

| Level | Meaning in this audit | Permitted claim |
|---|---|---|
| `source` | Direct inspection of reachable production source and imports. | The named code path exists and is reachable from the route. |
| `component_fake` | A focused automated test drives a component through injected stores, clocks, executors or other controlled doubles. | The component satisfies the tested contract under those controlled inputs. |
| `physical` | The exact candidate is exercised through real Git repositories, OS processes, worktrees, files, browser behavior or provider CLIs. | Only the observed physical boundary worked in the recorded environment. |
| `not_run` | No attributable execution receipt exists for this baseline cell. | Nothing passed; the cell remains unexecuted. |

`source` never upgrades to `component_fake` or `physical` automatically.
Likewise, a real-Git component test is not a productive-route end-to-end run.

## Reproducible source inspection

Run these commands from the repository root. Preserve their output with the
candidate/environment record; do not rewrite source as part of this inspection.

```powershell
git rev-parse HEAD
git status --short
rg -n "export async function (GET|POST)" apps/web/src/app/api/runs
rg -n "runPlanningV2Pipeline|startExecutionV2Pipeline|deliverRunV2|reconcileRunLiveness" apps/web/src
rg -n "projectSemanticPlanForLegacyCompiler|V2ExecutionDriver|selectReadyWaveV2" apps/web/src packages
rg -n "IntegrationManifestExecutor|ExactCandidateValidatorV2|final_candidate.verified" apps/web/src packages
rg -n -i --glob '!**/*.test.*' --glob '!**/tests/**' "backorders|currentBackorders|warehouse|SP2|G5|G6|G7" apps/web/src packages
rg -n --glob '!**/*.test.*' "@manyhands/(orchestrator-graph|conflict-risk)|projectSemanticPlanForLegacyCompiler" apps/web/src packages
```

The minimum focused component suite for this characterization is:

```powershell
pnpm exec vitest run tests/run-create-canonical-seed.test.ts tests/planning-v2-pipeline.test.ts tests/planning-v2-approval.test.ts tests/scheduler-readiness-v2.test.ts tests/run-v2-execution-driver.test.ts tests/run-v2-execution-host.test.ts tests/execution-core-v2-node-executor.test.ts tests/integration-manifest.test.ts tests/integration-operation-recovery.test.ts tests/exact-candidate-validation.test.ts tests/final-candidate.test.ts tests/delivery-state-machine.test.ts tests/run-store-event-source.test.ts tests/run-v2-record-cache-reconciliation.test.ts tests/run-liveness-supervisor.test.ts tests/run-v2-e2e.test.ts tests/run-v2-crash-recovery.test.ts tests/local-boundary.test.ts
```

Record the command result separately. Until that receipt exists on the frozen
candidate, the suite is `not_run` for G0 even though its test files exist.

## Productive route

| Step | Current producer and consumer | Source evidence | Baseline evidence |
|---|---|---|---|
| 1. Create run | `POST /api/runs` validates executor selections and execution config, captures the immutable Git target, persists a `RunRecord`, seeds the canonical journal and starts planning. | `apps/web/src/app/api/runs/route.ts:56-106` | `source`; focused test receipt pending |
| 2. Persist identity/cache | The application-scoped `JsonRunRecordStore` stores run identity, target, selections, leases and a disposable projection cache in JSON. Its in-memory write chain is held on `globalThis`, with a filesystem mutation lock across processes. | `apps/web/src/lib/server/runs/store.ts:4-10`; `apps/web/src/lib/server/runs/repository.ts:22-44,72-80,190-225,270-310` | `source`; focused test receipt pending |
| 3. Seed canonical lifecycle | `initializeRunCanonicalEvents` claims fenced authority and durably appends the idempotent `run.created` fact before the create response is returned. | `apps/web/src/lib/server/runs/v2/initialize-run.ts:10-31`; `packages/run-store/src/jsonl-event-store.ts:124-204` | `source`; focused test receipt pending |
| 4. Own planning in Next | The route registers `runPlanningV2Pipeline` as an in-process background promise. The active-run and background-task maps live on the Next.js process's `globalThis`. | `apps/web/src/app/api/runs/route.ts:99-106`; `apps/web/src/lib/server/runs/runner-state.ts:3-16,44-76` | `source`; process-restart cell `not_run` |
| 5. Inspect repository | Planning claims the run operation and repository lease, verifies the event store, then creates an exact-commit `RepositorySnapshot` through `buildFastRepositorySnapshot`. | `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:48-70,88-105`; `packages/repository-index/src/index.ts:371-410` | `source`; full physical view/restart evidence `not_run` |
| 6. Invoke planning model | `RecursivePlanner` invokes the selected Codex or Claude CLI once per cut attempt, with up to two attempts per unit so validation failures can trigger a repair prompt. The CLI runs read-only for Codex or plan mode with a disallowed-tool list for Claude. | `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:71-87,147-183,265-283`; `packages/decomposer/src/planner/recursive-planner.ts:209,328-351` | `source`; live-provider baseline `not_run` |
| 7. Build semantic plan | Planning folds grounded cuts into a `SemanticPlan` and applies the persisted granularity condition before compilation. | `apps/web/src/lib/server/runs/v2/planning-host.ts:73-164,165-198` | `source`; focused test receipt pending |
| 8. Project through legacy planning | The productive route reconstructs `WorkBreakdown` and `CandidatePlan` through `projectSemanticPlanForLegacyCompiler`; the compiler performs the same projection again. | `apps/web/src/lib/server/runs/v2/planning-host.ts:170-185`; `packages/decomposer/src/planner/semantic-plan-projection.ts:7-120`; `packages/decomposer/src/compiler/graph-compiler.ts:52-65` | `source`; this is a known transition gap, not a pass |
| 9. Compile and request approval | The compiler creates the graph/contracts/review; planning appends `graph.compiled`, critic findings, the proposed revision and an `approve_plan` decision. | `apps/web/src/lib/server/runs/v2/planning-host.ts:320-385` | `source`; focused test receipt pending |
| 10. Approve and start execution | Resolving `approve_plan` approves the exact graph revision and immediately registers the V2 execution pipeline as another background task in Next. | `apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts:38-53`; `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:101-114` | `source`; web-restart cell `not_run` |
| 11. Load exact execution inputs | The host folds the journal, requires the current approved graph, loads its contracts and the repository snapshot used by planning, and rejects mismatched snapshot identity. | `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:62-88,128-175` | `source`; focused test receipt pending |
| 12. Compose physical execution | The host constructs ephemeral workspaces, execution-base builder, trace store, CLI factory, exact-candidate validator, integration journal and final-candidate port. | `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:176-221` | `source`; combined physical route `not_run` |
| 13. Evaluate readiness | `V2ExecutionDriver` builds readiness from adopted artefacts, contract revisions, decisions, runtime resources, budget and executor availability. | `packages/orchestrator-graph/src/v2/execution-driver.ts:619-702`; `packages/scheduler/src/readiness-v2.ts:3-26` | `source`; focused test receipt pending |
| 14. Select work | `selectReadyWaveV2` orders ready nodes and filters them using graph and `conflict-risk` pair constraints before respecting `maxParallel`. | `packages/orchestrator-graph/src/v2/execution-driver.ts:196-289`; `packages/scheduler/src/wave-selector-v2.ts:27-66` | `source`; this is a known transition gap |
| 15. Dispatch attempts | The driver persists wave and attempt-start facts before starting executor promises, then serializes completed outcomes back into the journal. | `packages/orchestrator-graph/src/v2/execution-driver.ts:291-339` | `source`; crash-between-intent-and-effect matrix `not_run` |
| 16. Execute a leaf | `V2NodeExecutor` materializes the base, writes the instruction file, creates the selected CLI executor, executes with approval bypass enabled, and records the resulting diff/commit under scope policy. | `packages/execution-core/src/v2/node-executor.ts:223-326`; `packages/execution-core/src/executor/factory.ts:22-48`; `packages/execution-core/src/executor/cli-executor.ts:78-115` | `source`; real sandbox/provider capability `not_run` |
| 17. Validate exact candidate | `ExactCandidateValidatorV2` binds the frozen validation recipe, creates exact candidate and baseline worktrees, runs obligations and negative controls, and produces an Evidence Matrix tied to the candidate. | `packages/execution-core/src/v2/exact-candidate-validator.ts:56-138,138-203`; `packages/execution-core/src/validation/candidate-validator.ts:99-173` | `source`; component and physical receipts pending |
| 18. Repair leaf | A failed evidence matrix may trigger one repair CLI call; the repair is recorded and revalidated on a handoff commit. | `packages/execution-core/src/v2/node-executor.ts:615-701` | `source`; adverse repair cells `not_run` |
| 19. Adopt artefacts | After successful validation, the driver adopts every produced contract. Each productive artefact is currently `kind: "commit"`, with the candidate SHA as its location. | `packages/orchestrator-graph/src/v2/execution-driver.ts:445-550`, especially `:497-517` | `source`; immutable scoped manifest target not implemented |
| 20. Integrate composite | A composite creates an integration request from child artefacts. `IntegrationManifestExecutor` applies each child commit with `cherry-pick`, optionally performs one semantic repair, validates the combined candidate and records an integration manifest. | `packages/execution-core/src/v2/node-executor.ts:361-508`; `packages/execution-core/src/integration/manifest.ts:130-209,225-375` | `source`; real-Git component receipt pending; hierarchical product cell `not_run` |
| 21. Prepare final candidate | The root prepares a final manifest bound to commit/tree, graph revision, artefact ids, evidence matrix and validation recipe, then creates a retained `manyhands/run-*` branch. | `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:366-418` | `source`; GC/reachability cell `not_run` |
| 22. Request delivery | `POST /api/runs/[id]/deliver` validates the approval and calls `deliverRunV2`. Delivery remains a long-running operation owned by the web process. | `apps/web/src/app/api/runs/[id]/deliver/route.ts:23-29`; `apps/web/src/lib/server/runs/v2/command-host.ts:191-224` | `source`; delivery crash matrix `not_run` |
| 23. Publish | The publisher rechecks canonical metadata, candidate tree, target branch/head/fingerprint and cleanliness, then runs `git merge --ff-only` and verifies the delivered head. | `apps/web/src/lib/server/runs/v2/command-host.ts:278-359` | `source`; exact physical publication `not_run` |
| 24. Record receipt | Delivery records a stable request fingerprint, final SHA, target branch, before/after heads and confirmed disposition. | `apps/web/src/lib/server/runs/v2/command-host.ts:369-408` | `source`; ambiguous-publication recovery `not_run` |
| 25. Stream journal | `GET /api/runs/[id]/run-events` polls and streams the fenced V2 JSONL journal through SSE with replay by sequence. | `apps/web/src/app/api/runs/[id]/run-events/route.ts:17-59,75-99`; `packages/run-store/src/jsonl-event-store.ts:52-73` | `source`; browser reconnect/restart cell `not_run` |
| 26. Read and reconcile | `GET /api/runs/[id]` folds the journal and may write a repaired `RunRecord` cache. It then runs liveness supervision, which may invoke cancellation and verified process termination. | `apps/web/src/app/api/runs/[id]/route.ts:14-19`; `apps/web/src/lib/server/runs/v2/command-host.ts:57-79`; `apps/web/src/lib/server/runs/liveness-supervisor.ts:64-90` | `source`; contradicts target query purity |

## Persistence and authority topology

The V2 JSONL journal is the declared lifecycle authority. It provides durable
append, sequence compare-and-swap, idempotence by `eventId`, fencing and recovery
of incomplete trailing writes:

- `packages/run-store/src/jsonl-event-store.ts:52-73,124-204,220-232`
- `packages/run-store/src/recovery.ts:36-84`

`RunRecord` is described as a disposable projection cache, but it also owns
target identity, executor selections, `activeOperation`, heartbeat, mutation
fence and takeover receipt:

- `apps/web/src/lib/server/runs/schema.ts:74-117`
- `apps/web/src/lib/server/runs/run-operation-lease.ts:73-163`
- `apps/web/src/lib/server/runs/v2/run-record-cache.ts:4-26`

This is not merely duplicated storage. Until the daemon owns actors, effects
and reconciliation, operational authority is split between the journal fence,
the JSON run record and in-memory Next state.

## Legacy dualities frozen at G0

| Duality | Productive producer | Productive consumer or retained surface | Retirement implication |
|---|---|---|---|
| `SemanticPlan` versus `WorkBreakdown`/`CandidatePlan` | `planning-host.ts:152-164` | `planning-host.ts:170-185`; `graph-compiler.ts:63-65` | Stage 5/6 must compile directly without reconstructing legacy planning objects. |
| Canonical readiness versus pairwise conflict product | `execution-driver.ts:201-239` | `wave-selector-v2.ts:32-66`; `execution-pipeline.ts:6,336-347` | Stage 6 separates deterministic readiness from advisory selection and retires `conflict-risk`. |
| Scoped artefact obligation versus whole commit transport | `execution-driver.ts:497-517` | `integration/manifest.ts:207-238` | Stage 7 replaces commit transport with immutable Git-native scoped manifests. |
| Canonical journal versus web-owned actor state | `jsonl-event-store.ts`; `runner-state.ts` | create, decision, execution and delivery routes | Stage 2/3 moves commands, actors, processes and journal writes to the daemon. |
| Query versus recovery command | `GET /api/runs/[id]` | projection update and liveness cancellation | Stage 3 makes GET a pure query over daemon-owned projections. |
| Worktree isolation versus execution sandbox | `execution-pipeline.ts:184-205` | executor call uses `bypassApprovals: true` in `node-executor.ts:242-252` | Stage 8 must report and enforce OS/process/filesystem/network/credential capabilities separately. |
| New V2 components versus exported V1 implementations | No productive web import found for `RunExecutor` or `IntegrationAgent` | Both remain exported from `packages/execution-core/src/index.ts:43,55`; legacy decomposer policy remains in `apps/web/src/lib/decomposer-policy.ts` | Stage-specific reachability tests must precede physical deletion. |
| Canonical V2 persistence versus V1 import | `migrateLegacyRunFile` reads old files | `apps/web/src/lib/server/runs/v2/migrate-run.ts:55-140` | Compatibility may remain read-only; no new V1 producer is allowed. |

## Benchmark- and model-specific hardcodes

### Behavior-affecting benchmark knowledge

| Hardcode | Evidence | Why it is a gap |
|---|---|---|
| The generic recursive-planning output example names `backorders`. | `packages/decomposer/src/planner/recursive-planner.ts:600-609` | A productive generic prompt contains a benchmark-domain noun. |
| Public-surface validation extracts only `backorder(s)` as the requested state term. | `packages/execution-core/src/validation/test-integrity.ts:30-52` | Validation policy changes behavior for one benchmark vocabulary. |
| Code repair explicitly requires `currentBackorders()`. | `packages/execution-core/src/v2/node-executor.ts:856-881` | The productive repair prompt prescribes an exact fixture method. |
| The run schema exposes only experimental conditions `A` and `C`. | `apps/web/src/lib/server/runs/schema.ts:9-10,101-106,130-138` | A comparative-study condition is part of the product API and persistence shape. |

These are direct violations of invariant I43. Historical names that occur only
in comments (`Warehouse`, `SP2`, `G5`, `G6`, `G7`) do not currently branch
runtime behavior, but should still leave productive source when the Stage 11
source-hygiene gate is enforced.

### Model and effort registry

| Hardcode | Evidence | Frozen current behavior |
|---|---|---|
| Effort levels | `packages/shared/src/executor-registry.ts:17-18,52-56` | `low`, `medium`, `high`, `xhigh`; no `ultra`. |
| Codex models | `packages/shared/src/executor-registry.ts:63-67` | `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`. |
| Product default | `packages/shared/src/executor-registry.ts:58-70` | Claude Code `sonnet`. |
| Complexity routes | `packages/execution-core/src/routing/policy.ts:48-67` | Static Claude/Codex tier lists. The current V2 route uses explicit per-stage selections; the legacy router remains exported. |
| Legacy decomposer default | `apps/web/src/lib/decomposer-policy.ts:63,94-107,233-237` | `claude-sonnet-4-5` for its Anthropic path. No productive caller was found from the V2 route. |
| V1 migration default | `apps/web/src/lib/server/runs/v2/migrate-run.ts:167-170` | `claude-sonnet-4-5` when the old record lacks a model. |
| Pricing tables | `apps/web/src/lib/model-pricing.ts:14-18`; `packages/execution-core/src/pricing.ts:17-25` | Duplicated and incomplete model-specific rates. Unknown models deliberately have no fabricated cost. |

These values characterize the ManyHands product, not the Codex agent harness
used to implement the redesign. Harness model configuration must not be inferred
from this registry.

## Current evidence disposition

| Cell | Disposition | What would upgrade it |
|---|---|---|
| Static route reachability | `source` | This document plus the preserved inspection output on the frozen candidate. |
| Focused planning/scheduler/execution/validation/delivery tests | `not_run` in this document | Exact command receipt on the candidate; classify injected-boundary tests as `component_fake`. |
| Real-Git integration/worktree components | `not_run` | Exact test receipt plus retained temporary-repository evidence; still not an end-to-end product pass. |
| Full create → plan → approve → execute → integrate → validate → deliver route | `not_run` | A clean target, physical process/Git receipts, persisted journal and exact delivered SHA. |
| Browser-visible productive run and reconnect | `not_run` | Real UI path, screenshots, SSE/journal evidence and browser/Next restart observations. |
| Live Codex leaf | `not_run` | Stage 8 authorization and GLeaf evidence. |
| Live Claude leaf | `not_run` | Stage 8 authorization and GLeaf evidence. |
| Crash/recovery matrices | `not_run` | Per-effect injected crash receipts at GD1, GI and GDel. |

Historical thesis, Warehouse, G5-G7 and SP2 results do not upgrade any cell in
this table.

## Gaps that Stage 0 must carry forward

1. No `packages/run-engine` or `apps/daemon` owns the productive route yet.
2. Next.js owns background promises and process lifecycle; browser/web restart
   independence is unproven.
3. GET detail mutates projection state and can cancel work.
4. Productive planning still crosses a legacy projection before compilation.
5. Readiness and selection are coupled to the pairwise `conflict-risk` product.
6. Artefacts are transported as whole commits and integrated by cherry-pick.
7. Composite integration has useful validation and journaling, but not the
   final target's complete parent-owned resource/change contract.
8. Worktrees isolate checkouts but do not establish an OS sandbox; the leaf
   executor bypasses approval prompts.
9. Delivery has strong precondition checks and receipts but no general durable
   effect-intent protocol or completed ambiguous-publication crash matrix.
10. Benchmark-specific behavior remains in generic planning, validation and
    repair source.
11. Legacy implementations remain exported alongside current V2 modules.
12. Existing tests are evidence only after their exact candidate, environment,
    command and result are recorded; all physical full-route cells remain
    `not_run` at this characterization point.

## Baseline-test coverage and limits

`tests/architecture-baseline.test.ts` now checks the package-manager/Node
baseline, resolution-preserving lock conversion, V1/V2 cache separation,
package dependency direction, absence of `@manyhands/core`, the known files
containing each frozen legacy marker, and the Sol Ultra harness profiles.
`tests/documentation-current.test.ts` checks the I1-I43, DoC1-DoC26 and R0-R19
registries and rejects obsolete active-stage guidance.

These are transition guards, not proof of the target architecture. In
particular, the legacy-marker check freezes the set of files containing each
marker; it does not count call sites inside an already allowlisted file.
Stage-specific gates must still establish query purity, daemon ownership, I43
source hygiene, read-only legacy compatibility and final zero reachability.
