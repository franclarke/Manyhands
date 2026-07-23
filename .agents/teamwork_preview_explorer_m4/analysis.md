# TypeScript Typecheck Remediation Analysis Report

**Date**: 2026-07-22
**Explorer**: `teamwork_preview_explorer_m4`
**Target Repository**: `c:\Users\franc\Documents\Proyectos\Manyhands`

---

## Executive Summary

A full diagnostic type check run (`pnpm typecheck`) identified 12 distinct compilation error clusters across test files in the repository. All errors stem from schema evolutions in `@manyhands/task-graph`, `@manyhands/contracts`, `@manyhands/execution-core`, `@manyhands/run-coordinator`, and `apps/web` where test fixtures had not been updated to match current type contracts (e.g. removal of `TaskNode.dependencies` in favor of graph-level `dependencies`, introduction of `provenance` in `ValidationContract`, schema shifts in `RunRecord`, `GitRunner`, `DeliveryReceipt`, and `exactOptionalPropertyTypes` enforcement).

All errors have been fully diagnosed, traced to package type definitions, and provided with precise, type-safe remediation specifications.

---

## Detailed Error Cluster Diagnosis & Proposed Fixes

### Cluster 1: `tests/grounding-agent-dirty-workspace.test.ts`
* **Observed Errors**:
  - `(13,5)`: Error TS2353: Object literal may only specify known properties, and `fetch` does not exist in type `GitRunner`.
  - `(33,11), (50,11), (70,11)`: Error TS2322: Type `{ nodes: {}; }` is not assignable to type `TaskGraph`. Missing properties: `id`, `dependencies`, `baseCommit`, `rootId`, `planId`, `repo`, `baseBranch`, `featureRequest`, `createdAt`.
* **Package Contract**:
  - `GitRunner` in `packages/execution-core/src/git/runner.ts` does not contain a `fetch` method.
  - `TaskGraph` in `packages/task-graph/src/index.ts` requires complete metadata (`id`, `planId`, `repo`, `baseBranch`, `baseCommit`, `featureRequest`, `nodes`, `dependencies`, `rootId`, `createdAt`).
* **Proposed Fix**:
  1. In `createMockGit()`, remove line 13 (`fetch: vi.fn().mockResolvedValue(undefined)`).
  2. Create a helper function `createMockGraph(): TaskGraph`:
     ```ts
     function createMockGraph(): TaskGraph {
       return {
         id: "graph-1",
         planId: "plan-1",
         repo: "/mock/repo",
         baseBranch: "main",
         baseCommit: "head-commit-sha-123",
         featureRequest: "dirty-workspace-test",
         nodes: {},
         dependencies: [],
         rootId: "root",
         createdAt: "2026-07-22T00:00:00.000Z"
       };
     }
     ```
  3. Replace `{ nodes: {} }` with `createMockGraph()` on lines 33, 50, and 70.

---

### Cluster 2: `TaskNode.dependencies` Property Removal
* **Observed Errors**:
  - `tests/execution-core-skeleton-scaffolder.test.ts(348,5), (379,5)`: Error TS2353: `dependencies` does not exist in type `TaskNode`.
  - `tests/repository-aware-scheduling.test.ts(242,5), (255,5)`: Error TS2353: `dependencies` does not exist in type `TaskNode`.
  - `tests/scheduler-scope-aware-wave.test.ts(21,5), (70,5)`: Error TS2353: `dependencies` does not exist in type `TaskNode`.
  - `tests/task-graph-graft.test.ts(65,9), (98,9), (163,7)`: Error TS2353: `dependencies` does not exist in type `Partial<TaskNode>`.
  - `tests/task-graph-v1-compatibility.test.ts(68,9), (76,9)`: Error TS2353: `dependencies` does not exist in type `Partial<TaskNode>`.
* **Package Contract**:
  - In `@manyhands/task-graph` (v2 architecture), dependencies are declared on the graph level (`TaskGraph.dependencies: TaskDependency[]`). Individual `TaskNode` objects do NOT possess a `dependencies` property.
* **Proposed Fixes**:
  - `tests/execution-core-skeleton-scaffolder.test.ts`: Remove `dependencies: []` from `makeLeafWithSeams` (line 348) and `makeGraph` (line 379).
  - `tests/repository-aware-scheduling.test.ts`: Remove `dependencies: []` from line 242 and line 255.
  - `tests/scheduler-scope-aware-wave.test.ts`: Remove `dependencies: []` from line 21 and line 70.
  - `tests/task-graph-graft.test.ts`: Remove `dependencies: []` from `node()` helper default object (line 23) and remove `dependencies: [...]` overrides on lines 65, 98, 163.
  - `tests/task-graph-v1-compatibility.test.ts`: Remove `dependencies: []` from `node()` helper default object (line 95) and remove `dependencies: [...]` overrides on lines 68, 76.

---

### Cluster 3: `tests/granularity-mapping.test.ts`
* **Observed Errors**:
  - `(13,15)`: Error TS2305: Module `"@/lib/server/runs/schema"` has no exported member `GranularityMode`.
  - `(33,32)`: Error TS7053: Element implicitly has an 'any' type because expression of type `GranularityMode` can't be used to index `Record<GranularityMode, ...>`.
* **Package Contract**:
  - `GranularityMode` is defined and exported from `@/lib/granularity` (`apps/web/src/lib/granularity.ts`), not `@/lib/server/runs/schema`.
* **Proposed Fix**:
  - Update import line 13 to:
    ```ts
    import type { GranularityMode } from "@/lib/granularity";
    ```
    (or consolidate with line 2 import from `@/lib/granularity`).

---

### Cluster 4: `tests/helpers/workspace-reference-child.ts`
* **Observed Errors**:
  - `(3,39)`: Error TS2307: Cannot find module `@/lib/server/runs/fork-persistence`.
  - `(83,5)`: Error TS2353: Object literal may only specify known properties, and `granularity` does not exist in type `RunRecord`.
* **Package Contract**:
  - `persistForkAtomically` module was removed. Reference serialization across processes is handled directly via `withWorkspaceReferenceLock` in `@/lib/server/workspaces/reference-lock`.
  - `RunRecord` in `apps/web/src/lib/server/runs/schema.ts` uses structured stage selections (`planningSelection`, `executionSelection`, `repairSelection`, `targetContext`, `projection`) instead of legacy top-level `granularity`, `model`, `status`, `patches`.
* **Proposed Fix**:
  - Import `withWorkspaceReferenceLock` from `@/lib/server/workspaces/reference-lock`.
  - Replace `persistForkAtomically` block with `withWorkspaceReferenceLock` block (matching `"create"` action logic).
  - Use `makeRunRecordV2({ runId, workspaceId })` from `tests/helpers/run-v2-record.ts` in `runRecord()` helper.

---

### Cluster 5: `tests/run-coordinator-execution.test.ts`
* **Observed Errors**:
  - `(47,39)`: Error TS2322: Type `Promise<number>` is not assignable to type `Promise<void>`.
* **Package Contract**:
  - `dispatch` option in `RunExecutionCoordinator` options expects return type `Promise<void>` or `void`. Arrow expression `test.ordering.push(...)` returns array length (`number`).
* **Proposed Fix**:
  - Change line 47 to block statement:
    ```ts
    dispatch: async ({ nodeId }) => { test.ordering.push(`dispatch:${nodeId}`); }
    ```

---

### Cluster 6: `tests/validation-recipe.test.ts`
* **Observed Errors**:
  - `(6,7)`: Error TS2741: Property `provenance` is missing in type `ValidationContract`.
* **Package Contract**:
  - `ValidationContract` in `@manyhands/contracts` extends `ContractIdentityShape`, requiring `provenance: "authored" | "compiled" | "legacy_inferred"`.
* **Proposed Fix**:
  - Add `provenance: "compiled"` (or `"authored"`) to the `contract` object literal on line 7.

---

### Cluster 7: `tests/helpers/target-planning-fixtures.ts`
* **Observed Error**:
  - `(53,3)`: Error TS2375: `exactOptionalPropertyTypes: true` mismatch on `indexHash`.
* **Package Contract**:
  - `RepositorySnapshot` in `@manyhands/repository-index` defines `indexHash?: string`. `z.object().parse()` infers `indexHash?: string | undefined`, which under TS `exactOptionalPropertyTypes` requires explicit type assertion.
* **Proposed Fix**:
  - Cast return of `RepositorySnapshotSchema.parse(...)` to `RepositorySnapshot`.

---

### Cluster 8: `tests/planning-v2-pipeline.test.ts`
* **Observed Error**:
  - `(68,15), (69,15)`: Error TS2722: Cannot invoke an object which is possibly 'undefined'.
* **Package Contract**:
  - `observer` parameter in `plan: async (_input, observer) => ...` is optional (`PlanningProgressObserver | undefined`).
* **Proposed Fix**:
  - Use optional chaining: `await observer?.onAttemptStarted(...)` and `await observer?.onUnitDiscovered(...)`.

---

### Cluster 9: `tests/run-events-replay.test.ts` & `tests/run-v2-cancellation.test.ts`
* **Observed Errors**:
  - `run-events-replay.test.ts(72,40)`: Error TS2379: `{ directory: string | undefined }` with `exactOptionalPropertyTypes: true`.
  - `run-v2-cancellation.test.ts(49,42)`: Error TS2379: `{ directory: string | undefined }` with `exactOptionalPropertyTypes: true`.
* **Package Contract**:
  - `JsonlRunEventStoreOptions` expects `{ directory?: string }`. Passing `{ directory: process.env.MANYHANDS_RUNS_DIR }` provides `string | undefined`.
* **Proposed Fix**:
  - Pass `{ ...(process.env.MANYHANDS_RUNS_DIR ? { directory: process.env.MANYHANDS_RUNS_DIR } : {}) }`.

---

### Cluster 10: `tests/run-model-presentation.test.ts`
* **Observed Error**:
  - `(45,7)`: Error TS2322: Type `"high"` is not assignable to type `"medium"`.
* **Package Contract**:
  - `ConflictConstraint.risk` is `"low" | "medium" | "high"`. In fixture `graph()`, `risk: "medium" as const` narrowed array element type to `"medium"`.
* **Proposed Fix**:
  - Type `risk: "medium" as ConflictConstraint["risk"]` (or type return of `graph(): GraphRevision`).

---

### Cluster 11: `tests/run-store-fencing.test.ts`
* **Observed Error**:
  - `(32,222)`: Error TS2353: Object literal may only specify known properties, and `publishedAt` does not exist in type `DeliveryReceipt`.
* **Package Contract**:
  - `DeliveryReceiptSchema` in `@manyhands/run-coordinator` / `@manyhands/contracts` specifies `receiptId`, `manifestId`, `destination`, `confirmed`, `disposition`, `finalSha`, etc., but NOT `publishedAt`.
* **Proposed Fix**:
  - Remove `publishedAt: at` from `receipt` payload object literal on line 32.
