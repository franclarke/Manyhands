# Handoff Report — ManyHands Documentation Overhaul & Package Audit (Explorer 1)

**Agent ID**: Explorer 1 (`.agents/explorer_survey_1`)  
**Parent Agent**: `f87b7264-86b3-4d7d-8bb5-aa4e9f59803e`  
**Scope**: In-depth inspection and audit of `packages/contracts`, `packages/task-graph`, `packages/shared`, `packages/decomposer`, `packages/repository-index`.

---

## 1. Observation

- **`packages/contracts`**:
  - Contains 25 TypeScript source files in `src/`. Exported schemas cover the entire target architecture lifecycle: `GoalContractSchema`, `SemanticPlanSchema`, `WorkUnitSchema`, `TaskContractBundleSchema`, `ScopeContractSchema`, `OutputRootSchema`, `SeamContractSchema`, `ArtifactContractSchema`, `ArtifactManifestSchema`, `ValidationContractSchema`, `ProofStrategySchema`, `EvidenceBindingSchema`, `EffectIntentSchema`, `PhysicalEffectReceiptSchema`, `InputFingerprintSchema`, and `RecoveryDiagnosticSchema`.
  - Canonical hashing is implemented deterministically in `src/identity.ts` via `computeCanonicalDigest` and `verifyCanonicalDigest`.
  - Legacy schemas (`AgentTaskContract`, `ContextPack`, `InterfaceContract`) are isolated under `src/legacy/`.
  - `README.md` is an 11-line placeholder.

- **`packages/task-graph`**:
  - Contains 10 TypeScript source files in `src/`. Implements the canonical executable graph revision model: `GraphRevisionSchema`, `CanonicalTaskNode`, `ResourceClaimSchema`, `RuntimeLeaseClaimSchema`, `ArtifactRequirementSchema`, `SeamBindingSchema`.
  - Resource authority enforcement is implemented in `src/resource-authority.ts` (`checkResourceAuthority`, `describeResourceAuthorityViolations`), requiring an explicit `modify` claim for write title independent of scope boundaries.
  - Topological levels (`src/topological-levels.ts`) are derived purely for canvas layout (`computeGraphRevisionTopologicalLevels`); runtime scheduling remains continuous.
  - Legacy V2 graph (`LegacyGraphRevisionV2Schema`) and unified reader (`readGraphRevision`, `readLegacyGraphForCompatibility`) bridge transitional callers.
  - `README.md` is an 11-line placeholder.

- **`packages/shared`**:
  - Contains 3 TypeScript source files in `src/`. Has zero dependencies on other ManyHands packages.
  - `src/index.ts`: Defines `ReasoningEffortSchema`, `EpistemicAssessmentSchema`, `IsoTimestampSchema`, `EntityIdSchema`, and set mathematics functions (`uniqueValues`, `intersectValues`, `clamp01`, `pairKey`).
  - `src/executor-registry.ts`: Authoritative registry of AI executors (`claude-code`, `codex`, `opencode`), models, and reasoning effort support.
  - `src/node-cli-process.ts` (subpath export `./node-cli-process`): Implements `resolveCliBinaryPath`, `resolveCliProcessInvocation` (DEP0190 mitigation for Windows shell execution), and `killCliProcessTree` (Windows `taskkill` process-tree termination with fallback).
  - `README.md` is a 16-line placeholder.

- **`packages/decomposer`**:
  - Contains 31 TypeScript source files in `src/`.
  - Canonical planning pipeline: `PlanningEngine` (`src/planning-engine/planning-engine.ts`) with budget tracking (`PlanningBudget`), causal loop prevention (`no_progress`), and human decision continuations (`DecisionDraft`).
  - Verification & Direct Compilation: `verifyPlan` (`src/compiler/plan-verifier.ts`) checks 8 strict invariants; `compilePlan` (`src/compiler/direct-plan-compiler.ts`) compiles `SemanticPlan` directly into `GraphRevision` and `CompiledPlanContracts`.
  - Granularity: `GranularityPolicy` 4.0 (`src/granularity/granularity-policy.ts`) defines 3 categorical reasons (`doesNotFit`, `runsInParallel`, `verifiableApart`) replacing numerical threshold heuristics.
  - Legacy/Transitional: `RecursiveDecomposer`, `AnthropicDecomposer`, `WorkBreakdownSchema`, and `graph-compiler.ts` co-exist for historical compatibility.
  - `README.md` is a 16-line placeholder.

- **`packages/repository-index`**:
  - Contains 10 TypeScript source files in `src/`.
  - Grounding model: `RepositoryModel` (`src/repository-model.ts`) inspects exact Git blob objects (`ls-tree`, `cat-file`) and parses TypeScript ASTs (`PackageBoundary`, `ModuleBoundary`, `RepositorySymbolRecord`, `PublicInterfaceRecord`, `TestRelationship`).
  - Catalog & View: `ResourceCatalog` (`src/resource-catalog.ts`) resolves resources and overlap queries; `composeRepositoryView` (`src/repository-view.ts`) composes immutable overlay stacks.
  - Budgeted Query: `createRepositoryQuery` (`src/repository-query.ts`) provides bounded search (`searchGoalTerms`, `inspectBoundary`, `dependencyNeighborhood`, `relatedSymbols`, `relatedTests`, `validationCapabilities`, `readExcerpts`) with honest epistemic state degradation on truncation.
  - Indexing: `FastRepositoryIndexer` (Ripgrep-accelerated) and `TypeScriptRepositoryIndexer`.
  - `README.md` is an 11-line placeholder.

---

## 2. Logic Chain

1. **Foundational Architecture Alignment**:
   - `packages/contracts` and `packages/shared` represent the bottom layer of the dependency graph. Their canonical schemas and deterministic digest functions ensure that data across all downstream packages is content-addressed and type-safe.
2. **Execution Model Integrity**:
   - `packages/task-graph` enforces safety invariants (`checkResourceAuthority`, DAG acyclicity) using contracts provided by `packages/contracts`. The distinction between `ScopeContract` (bounding box) and `ResourceClaim` (modification title) prevents multi-agent write races.
3. **Planning & Grounding Pipeline**:
   - `packages/repository-index` exposes bounded, cost-tracked repository inspection (`RepositoryQuery`) to `packages/decomposer`'s `PlanningEngine`.
   - `PlanningEngine` produces a `SemanticPlan`, which passes `verifyPlan` and is transformed by `direct-plan-compiler.ts` into a `GraphRevision` for `packages/task-graph`.
4. **Transition Gaps**:
   - The target architecture for Stages 1-4 is fully implemented in TypeScript source code and covered by tests under `tests/`.
   - Legacy layers (`src/legacy/` in contracts and task-graph, `WorkBreakdown` in decomposer) remain solely to preserve backward compatibility with historical runs and non-migrated executors.
5. **Documentation State**:
   - All 5 packages currently have minimal stub READMEs (11-16 lines) that do not reflect the rich implementations. Detailed package-level documentation is required.

---

## 3. Caveats

- **Scope Limitation**: This investigation was strictly read-only and covered only the 5 assigned packages (`contracts`, `task-graph`, `shared`, `decomposer`, `repository-index`). Execution runtime (`execution-core`), coordination daemon (`run-engine`, `daemon`), scheduler (`scheduler`), and web UI (`apps/web`) were not in scope.
- **Transitional Code Coexistence**: While target canonical schemas and direct compilers are fully functional and tested, parts of the active test suite and legacy runners still invoke transitional adapters (`LegacyGraphRevisionV2`, `adaptLegacyAgentTaskContract`).

---

## 4. Conclusion

- The technical survey and audit for the 5 packages is complete and documented in full detail in `.agents/explorer_survey_1/survey_report.md`.
- All exported schemas, types, methods, design patterns, validation rules, and transition gaps have been mapped and cataloged.
- The 5 packages represent a solid, mature implementation of Stages 1 through 4 of the canonical redesign plan (`2026-08-12-correctness-first-system-redesign.md`).
- Recommended next action: Use `survey_report.md` as the primary technical reference to draft comprehensive, production-grade `README.md` files for each of the 5 packages.

---

## 5. Verification Method

To independently verify the findings in this report:

1. **Inspect Survey Report**:
   ```bash
   view_file .agents/explorer_survey_1/survey_report.md
   ```
2. **Verify Typecheck and Compilation**:
   ```bash
   pnpm -r --filter "./packages/contracts" --filter "./packages/task-graph" --filter "./packages/shared" --filter "./packages/decomposer" --filter "./packages/repository-index" typecheck
   ```
3. **Run Target Package Test Suite**:
   ```bash
   pnpm test tests/canonical-contract-roundtrip.test.ts tests/canonical-graph-invariants.test.ts tests/direct-plan-compiler.test.ts tests/plan-verifier.test.ts tests/repository-model.test.ts tests/repository-query.test.ts tests/resource-catalog.test.ts tests/executor-registry.test.ts tests/node-cli-process.test.ts
   ```
