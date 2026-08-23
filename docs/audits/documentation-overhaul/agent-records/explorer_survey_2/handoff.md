# Handoff Report — Explorer 2 Survey: Execution, Scheduling, Engine & Persistence

## 1. Observation

A deep code inspection was conducted across the 8 assigned packages:
- `packages/scheduler`: `package.json:1-27`, `README.md:1-11`, `src/index.ts:1-1001`, `src/canonical-frontier.ts:1-260`, `src/readiness-v2.ts:1-39`, `src/types-v2.ts:1-31`, `src/wave-selector-v2.ts:1-78`.
- `packages/conflict-risk`: `package.json:1-27`, `README.md:1-13`, `src/index.ts:1-895`, `src/constraint-evidence.ts:1-18`.
- `packages/execution-core`: `package.json:1-33`, `README.md:1-12`, `src/index.ts:1-69`, `src/types.ts:1-415`, `src/git/artifact-builder.ts:1-173`, `src/git/exact-manifest-materializer.ts:1-133`, `src/base/execution-base-builder.ts:1-119`, `src/validation/evidence-matrix.ts:1-158`, `src/v2/node-executor.ts:1-1298`.
- `packages/run-store`: `package.json:1-27`, `README.md:1-12`, `src/index.ts:1-15`, `src/event-store.ts:1-54`, `src/jsonl-event-store.ts:1-606`, `src/effect-input-store.ts:1-230`, `src/projection-fold.ts`, `src/durable-file.ts`, `src/durable-lock.ts`, `src/compactor.ts`.
- `packages/trace-store`: `package.json:1-25`, `README.md:1-11`, `src/trace-types.ts:1-134`, `src/jsonl-trace-store.ts:1-195`.
- `packages/run-engine`: `package.json:1-26`, no existing `README.md`, `src/index.ts:1-7`, `src/durable-run-engine.ts:1-101`, `src/run-actor.ts:1-746`, `src/effect-dispatcher.ts`, `src/physical-effect-adapters.ts`, `src/run-actor-registry.ts`.
- `packages/run-coordinator`: `package.json:1-27`, no existing `README.md`, `src/index.ts:1-25`, `src/domain/events.ts:1-408`, `src/command-envelope.ts`, `src/reducer.ts`, `src/coordinator.ts`.
- `packages/orchestrator-graph`: `package.json:1-33`, `README.md:1-11`, `src/index.ts:1-25`, `src/canonical-execution-driver.ts:1-668`, `src/concurrent-resource-invariant.ts`, `src/execution-base-closure.ts`.

Key direct observations:
1. `packages/run-engine/README.md` and `packages/run-coordinator/README.md` do NOT exist.
2. The README files for `packages/scheduler`, `packages/conflict-risk`, `packages/execution-core`, `packages/run-store`, `packages/trace-store`, and `packages/orchestrator-graph` are stubs consisting of 11 to 13 lines without code examples, interface catalogs, or design pattern documentation.
3. The codebase contains clear canonical modules corresponding to the redesign plan (`canonical-frontier.ts`, `canonical-execution-driver.ts`, `ExactGitManifestMaterializer`, `GitArtifactBuilder`, `FileEffectInputStore`, `DurableRunEngine`, `RunActor`, `reduceRun`/`foldRun`, `buildEvidenceMatrix`), alongside transitional legacy adapters that are planned for retirement in Stage 11.

## 2. Logic Chain

1. From inspection of `docs/plans/2026-08-12-correctness-first-system-redesign.md` (Sections 9.5 to 9.17) and the actual code in `src/`, ManyHands has implemented Stage 0 through Stage 10 (with Stage 11 in progress), establishing canonical architectures for event sourcing, execution bases, sandboxes, and readiness scheduling.
2. However, the documentation for external third parties and internal developers is fragmented or non-existent in these 8 packages: 2 packages lack READMEs entirely, and 6 have short stubs.
3. Therefore, producing full pedagogical Spanish READMEs (retaining English technical terms/symbols) and centralized documentation in `docs/modules/` is urgently needed to make the system understandable, maintainable, and aligned with the canonical architecture.

## 3. Caveats

- Only the 8 assigned packages were surveyed in depth; other packages (`packages/contracts`, `packages/task-graph`, `packages/repository-index`, `packages/decomposer`, `apps/*`, `native/*`) are assigned to peer explorers (Explorer 1 and Explorer 3).
- No production source code was modified during this survey (strictly read-only investigation).

## 4. Conclusion

The survey for the 8 packages is complete. A comprehensive technical report has been compiled and saved to `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\explorer_survey_2\survey_report.md`. It covers:
- Module purpose & role in lifecycle.
- Modular architecture & directory layouts.
- Design patterns & implementation strategies.
- Exact exported symbols, interfaces, types, schemas, and domain events.
- Transition status vs `2026-08-12-correctness-first-system-redesign.md`.
- Exhaustive README diagnostic and required documentation actions.

## 5. Verification Method

1. Inspect `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\explorer_survey_2\survey_report.md` to review the findings for all 8 packages.
2. Run TypeScript typecheck and Vitest tests to confirm consistency:
   ```bash
   pnpm -r --filter "./packages/*" typecheck
   pnpm test
   ```
3. Check that the exported symbols listed in `survey_report.md` match the exports in each package's `src/index.ts`.
