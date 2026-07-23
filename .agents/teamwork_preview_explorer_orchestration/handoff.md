# Handoff Report: Task Graph & Orchestration Audit

## 1. Observation
- **Package Audit Scope**: Analyzed `packages/task-graph`, `packages/decomposer`, `packages/orchestrator-graph`, `packages/scheduler`, `packages/conflict-risk`, and `packages/contracts`.
- **Target Specs**: Compared against `docs/system/01-task-graph.md`, `02-contracts.md`, `03-decomposer.md`, `12-scheduler.md`, and `13-conflict-risk.md`.
- **Key Inspection Findings**:
  - `packages/task-graph/src/validate-v2.ts` (lines 24–50, 80–98): `validateGraphRevision` only calls `hierarchyCycleNodes`, missing `ArtifactRequirement` DAG cycle detection (`MH-AUDIT-ORCH-001`).
  - `packages/scheduler/src/wave-selector-v2.ts` (lines 6–19) & `packages/orchestrator-graph/src/v2/execution-driver.ts` (lines 126–132): `selectReadyWaveV2` ignores compiled `GraphRevision.conflictConstraints` during wave selection (`MH-AUDIT-ORCH-002`).
  - `packages/orchestrator-graph/src/v2/execution-driver.ts` (lines 159–169): Chained `recording` promise mutation inside `Promise.all` can cause cascading unhandled rejections and lacks attempt abort signals (`MH-AUDIT-ORCH-003`).
  - `packages/decomposer/src/critics/review.ts` (lines 100–102): `reviewScopes` treats any existing path in `plannedPaths` as an error, blocking valid refactoring plans (`MH-AUDIT-ORCH-004`).
  - `packages/orchestrator-graph/src/v2/execution-driver.ts` (lines 250–270): Unverified evidence matrix outcomes record candidate creation without failure events (`MH-AUDIT-ORCH-005`).

## 2. Logic Chain
1. **Target Specification Analysis**: `01-task-graph.md` mandates that a graph revision is executable only if `ArtifactRequirement` edges are acyclic and graph conflict constraints regulate scheduling.
2. **Implementation Verification**: Direct inspection of `validate-v2.ts` revealed that cycle detection is only implemented for `parentId` parentage links. Artifact requirements are never sorted topologically or checked for cycles.
3. **Execution & Scheduling Trace**: In `wave-selector-v2.ts`, `selectReadyWaveV2` evaluates conflicts using only an external `conflictConstraints: ConflictConstraintEvidence[]` argument. In `execution-driver.ts`, `input.conflictConstraints` is passed while `graph.conflictConstraints` (produced by `graph-compiler.ts`) is ignored.
4. **Concurrency Audit**: `V2ExecutionDriver.advance` executes wave attempts in parallel via `Promise.all`. The recording chain mutates a single promise variable `recording = persisted.then(...)`. A rejection in any attempt's persistence cascades rejection down all subsequent attempts in that wave.

## 3. Caveats
- No live code modifications were made (read-only investigation per role identity).
- Runtime behavior was analyzed via static code inspection and tracing against existing test suites (`tests/decomposer.test.ts`, `tests/contracts-v2.test.ts`, `tests/task-graph*.test.ts`).

## 4. Conclusion
The task graph and orchestration codebase has successfully implemented core V2 domain structures (`GraphRevision`, `TaskContractBundle`, `ExecutionDriver`), but exhibits critical validation gaps and integration disconnects (`MH-AUDIT-ORCH-001` through `MH-AUDIT-ORCH-010`). Fixing these 10 cataloged issues will align the execution engine fully with target specifications.

## 5. Verification Method
1. **Audit Report Inspection**: Read full details and line citations in `.agents/teamwork_preview_explorer_orchestration/report.md`.
2. **DAG Cycle Invalidation Test**: Create a graph with a cyclic `ArtifactRequirement` (A -> B -> A). Run `validateGraphRevision(graph)` to confirm no error is currently raised.
3. **Conflict Constraint Wave Test**: Pass a `GraphRevision` with `conflictConstraints` to `V2ExecutionDriver` without passing external `conflictConstraints`. Confirm overlapping tasks are scheduled in parallel.
4. **Test Suite Verification**:
   ```bash
   pnpm test
   pnpm --filter @manyhands/task-graph test
   pnpm --filter @manyhands/decomposer test
   pnpm --filter @manyhands/scheduler test
   ```
