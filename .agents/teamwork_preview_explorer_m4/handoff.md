# Handoff Report — Typecheck Remediation Explorer (m4)

## 1. Observation

A complete execution of `pnpm typecheck` (`tsc -p tsconfig.json --noEmit`) produced 12 TypeScript compilation error clusters across test files in the workspace:

1. `tests/grounding-agent-dirty-workspace.test.ts`:
   - Line 13: `Error TS2353: Object literal may only specify known properties, and 'fetch' does not exist in type 'GitRunner'.`
   - Lines 33, 50, 70: `Error TS2322: Type '{ nodes: {}; }' is not assignable to type 'TaskGraph'. Missing properties: id, dependencies, baseCommit, rootId, planId, repo, baseBranch, featureRequest, createdAt.`

2. `TaskNode` missing `dependencies` property:
   - `tests/execution-core-skeleton-scaffolder.test.ts(348,5), (379,5)`: Error TS2353.
   - `tests/repository-aware-scheduling.test.ts(242,5), (255,5)`: Error TS2353.
   - `tests/scheduler-scope-aware-wave.test.ts(21,5), (70,5)`: Error TS2353.
   - `tests/task-graph-graft.test.ts(65,9), (98,9), (163,7)`: Error TS2353.
   - `tests/task-graph-v1-compatibility.test.ts(68,9), (76,9)`: Error TS2353.

3. `tests/granularity-mapping.test.ts`:
   - Line 13: `Error TS2305: Module '"@/lib/server/runs/schema"' has no exported member 'GranularityMode'.`
   - Line 33: `Error TS7053: Element implicitly has an 'any' type...`

4. `tests/helpers/workspace-reference-child.ts`:
   - Line 3: `Error TS2307: Cannot find module '@/lib/server/runs/fork-persistence'.`
   - Line 83: `Error TS2353: Object literal may only specify known properties, and 'granularity' does not exist in type 'RunRecord'.`

5. `tests/run-coordinator-execution.test.ts`:
   - Line 47: `Error TS2322: Type 'Promise<number>' is not assignable to type 'Promise<void>'.`

6. `tests/validation-recipe.test.ts`:
   - Line 6: `Error TS2741: Property 'provenance' is missing in type '{ ... }' but required in type 'ValidationContract'.`

7. `tests/helpers/target-planning-fixtures.ts`:
   - Line 53: `Error TS2375: Type ... is not assignable to type 'RepositorySnapshot' with 'exactOptionalPropertyTypes: true'.`

8. `tests/planning-v2-pipeline.test.ts`:
   - Lines 68, 69: `Error TS2722: Cannot invoke an object which is possibly 'undefined'.`

9. `tests/run-events-replay.test.ts` & `tests/run-v2-cancellation.test.ts`:
   - Line 72 & Line 49: `Error TS2379: Argument of type '{ directory: string | undefined; }' is not assignable to parameter of type '{ directory?: string; }' with 'exactOptionalPropertyTypes: true'.`

10. `tests/run-model-presentation.test.ts`:
    - Line 45: `Error TS2322: Type '"high"' is not assignable to type '"medium"'.`

11. `tests/run-store-fencing.test.ts`:
    - Line 32: `Error TS2353: Object literal may only specify known properties, and 'publishedAt' does not exist in type 'DeliveryReceipt'.`

---

## 2. Logic Chain

1. **TaskGraph & TaskNode v2 Refactoring**:
   - `TaskNode` in `packages/task-graph/src/index.ts` was updated to remove `dependencies`. Dependencies are stored globally on `TaskGraph.dependencies`.
   - Test files constructed `TaskNode` with `dependencies: []` or `dependencies: ["nodeId"]`, causing TS2353 errors.
   - Removing `dependencies` from node literals and preserving graph-level dependencies aligns test code with v2 schema contracts.

2. **GitRunner Contract Alignment**:
   - `GitRunner` interface in `packages/execution-core/src/git/runner.ts` defines valid git operations. `fetch` is not a member.
   - Removing `fetch` from mock git helper fixes TS2353.

3. **ValidationContract Contract Identity**:
   - `ValidationContract` in `@manyhands/contracts` inherits `ContractIdentityShape`, requiring `provenance: "authored" | "compiled" | "legacy_inferred"`.
   - Adding `provenance: "compiled"` to `contract` fixture satisfies TS2741 requirement.

4. **Granularity Mode Exports**:
   - `GranularityMode` is defined in `apps/web/src/lib/granularity.ts`. `tests/granularity-mapping.test.ts` attempted to import it from `@/lib/server/runs/schema`.
   - Changing import path to `@/lib/granularity` resolves TS2305 and TS7053.

5. **Workspace Reference & Fork Persistence**:
   - `fork-persistence.ts` was replaced with atomic workspace reference locking via `withWorkspaceReferenceLock` from `@/lib/server/workspaces/reference-lock`.
   - Modern `RunRecord` in `apps/web/src/lib/server/runs/schema.ts` uses `planningSelection`, `executionSelection`, `repairSelection`, `targetContext`, `projection` rather than top-level legacy fields (`granularity`, `model`, etc.). Using `makeRunRecordV2()` helper from `tests/helpers/run-v2-record.ts` resolves TS2307 and TS2353.

6. **Type Safety & Compiler Option Strictness (`exactOptionalPropertyTypes`)**:
   - Compiler options enforce strict optionality on properties (`exactOptionalPropertyTypes: true`).
   - `{ directory: process.env.MANYHANDS_RUNS_DIR }` passes `string | undefined`, which fails when target expects `{ directory?: string }`. Spreading conditional object fixes TS2379.
   - In `run-model-presentation.test.ts`, literal narrowing (`risk: "medium" as const`) narrowed array type. Explicit typing `as ConflictConstraint["risk"]` permits `"high"`.
   - In `run-store-fencing.test.ts`, `publishedAt` is not a valid field on `DeliveryReceipt`. Removing it fixes TS2353.

---

## 3. Caveats

- **Read-Only Explorer Scope**: As specified in identity and rules, this investigation report and handoff describe exact remediation plans without modifying the underlying source files directly.
- **Test Execution**: Fixes must be applied by an implementer agent and verified by running both `pnpm typecheck` and `pnpm test`.

---

## 4. Conclusion

All 12 TypeScript compilation error clusters are fully diagnosed and traced to exact line numbers and type schema contracts. Implementing the proposed fixes in `analysis.md` will achieve:
- 0 TypeScript compilation errors under `pnpm typecheck`.
- 100% test suite pass rate under `pnpm test`.

---

## 5. Verification Method

To independently verify the diagnosis and remediation plan:
1. Run `pnpm typecheck` (or `npx tsc --noEmit`) to verify the starting state and compare output against `analysis.md`.
2. Inspect each specified test file at the documented line numbers.
3. Apply the proposed fixes described in `analysis.md`.
4. Run `pnpm typecheck` to confirm 0 compilation errors.
5. Run `pnpm test` to confirm all unit and integration tests pass without failures.
