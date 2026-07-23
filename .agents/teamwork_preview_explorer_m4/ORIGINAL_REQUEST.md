## 2026-07-22T17:37:41Z

You are teamwork_preview_explorer_m4 (Typecheck Remediation Explorer).
Your working directory is: c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_m4 (create this directory if needed).
Root repository: c:\Users\franc\Documents\Proyectos\Manyhands

OBJECTIVE:
Investigate and diagnose all TypeScript errors emitted by `pnpm typecheck` (or `tsc -p tsconfig.json --noEmit`) in test files across the repository.

ERROR CLUSTERS TO INVESTIGATE:
1. `tests/grounding-agent-dirty-workspace.test.ts(33,11)`: Error TS2322: Type `{ nodes: {}; }` is not assignable to type `TaskGraph`. Missing properties: `id`, `dependencies`, `baseCommit`, `rootId`.
2. `tests/execution-core-skeleton-scaffolder.test.ts(348,5)`: Error TS2353: Object literal may only specify known properties, and `dependencies` does not exist in type `TaskNode`.
3. `tests/granularity-mapping.test.ts(13,15)`: Error TS2305: Module `"@/lib/server/runs/schema"` has no exported member `GranularityMode`.
4. `tests/helpers/workspace-reference-child.ts(3,39)`: Error TS2307: Cannot find module `@/lib/server/runs/fork-persistence`.
5. `tests/run-coordinator-execution.test.ts(47,39)`: Error TS2322: Type `Promise<number>` is not assignable to type `Promise<void>`.
6. `tests/task-graph-graft.test.ts(65,9)`: Error TS2353: Object literal may only specify known properties, and `dependencies` does not exist in type `Partial<TaskNode>`.
7. `tests/validation-recipe.test.ts(6,7)`: Error TS2741: Property `provenance` is missing in type.

INSTRUCTIONS:
1. Run `pnpm typecheck` or `npx tsc --noEmit` to get the full exact list of TypeScript compilation errors across the monorepo.
2. Inspect each of the 7 failing test files (and any other files emitting TypeScript errors).
3. Determine the exact type definitions in `@manyhands/task-graph`, `@manyhands/contracts`, `@manyhands/execution-core`, and `apps/web`.
4. Formulate precise, type-safe fixes for each file so that:
   - `pnpm typecheck` succeeds with 0 TypeScript errors.
   - `pnpm test` continues to pass with 0 test failures.
5. Save your diagnostic report to `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_m4\analysis.md`.
6. Save a self-contained `handoff.md` in your working directory and send a message to caller ("parent", conversation ID: "20bc03fb-88e2-4221-8257-1608e3cade0c").
