## 2026-07-22T14:40:55Z
OBJECTIVE:
Execute Milestone 4 Typecheck Remediation: Fix all TypeScript compilation errors across test files in the workspace so that `pnpm typecheck` passes cleanly with 0 errors.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or suppress TypeScript errors with `@ts-nocheck` or `any` casts. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

INPUT ARTIFACTS TO CONSULT:
- Explorer Analysis: `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_m4\analysis.md`
- Explorer Handoff: `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_m4\handoff.md`

TASKS:
Apply the type-safe fixes to the 12 error clusters identified in `analysis.md` / `handoff.md`:

1. `tests/grounding-agent-dirty-workspace.test.ts`:
   - Remove `fetch` from mock git runner helper.
   - Update mock `TaskGraph` fixture to include required properties (`id`, `rootId`, `baseCommit`, `dependencies`, `nodes`, `planId`, `repo`, `baseBranch`, `featureRequest`, `createdAt`).

2. Remove invalid `dependencies` property from `TaskNode` objects in:
   - `tests/execution-core-skeleton-scaffolder.test.ts`
   - `tests/repository-aware-scheduling.test.ts`
   - `tests/scheduler-scope-aware-wave.test.ts`
   - `tests/task-graph-graft.test.ts`
   - `tests/task-graph-v1-compatibility.test.ts`

3. `tests/granularity-mapping.test.ts`:
   - Fix import of `GranularityMode` from `@/lib/granularity` instead of `@/lib/server/runs/schema`.

4. `tests/helpers/workspace-reference-child.ts`:
   - Fix module path import for workspace reference locking and `RunRecord` schema compliance (`makeRunRecordV2` or modern schema fields).

5. `tests/run-coordinator-execution.test.ts`:
   - Fix return type mismatch (`Promise<void>` vs `Promise<number>`).

6. `tests/validation-recipe.test.ts`:
   - Add missing `provenance: "compiled"` (or `"authored"`) to `ValidationContract` object.

7. `tests/helpers/target-planning-fixtures.ts`:
   - Align `RepositorySnapshot` optional properties for `exactOptionalPropertyTypes`.

8. `tests/planning-v2-pipeline.test.ts`:
   - Add optional chaining / safety check for optional function call.

9. `tests/run-events-replay.test.ts` & `tests/run-v2-cancellation.test.ts`:
   - Spread conditional directory property `{ ...(directory ? { directory } : {}) }`.

10. `tests/run-model-presentation.test.ts`:
    - Cast literal string `risk: "high" as ConflictConstraint["risk"]`.

11. `tests/run-store-fencing.test.ts`:
    - Remove invalid `publishedAt` property from `DeliveryReceipt` object.

VERIFICATION:
- Run `pnpm typecheck` (or `pnpm -r --filter "./packages/*" typecheck`, `pnpm --filter @manyhands/web exec tsc --noEmit`, `pnpm typecheck`) and verify 0 TypeScript errors.
- Run `pnpm test` and verify all 168 test suites pass cleanly.
- Run `pnpm build` and verify packages build cleanly.
- Write your handoff report to `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\worker_m4\handoff.md`.
- Send a message to caller ("parent", conversation ID: "20bc03fb-88e2-4221-8257-1608e3cade0c") when complete.
