# Review Report — Milestone 2: Planning & Grounding READMEs

## Review Summary

**Verdict**: `REQUEST_CHANGES`

**Reviewed Artifacts**:
- `packages/decomposer/README.md`
- `packages/repository-index/README.md`

**Summary Assessment**:
Both documentation files are exceptionally well-written, pedagogically deep, and accurately capture the core architectural principles of ManyHands (grounding in exact Git objects, progressive budgeted planning, categorical granularity 4.0, deterministic plan verification, and honest epistemic degradation). The directory trees, 8-category verifier breakdown, transition status mapping, and almost all code snippets are exemplary.

However, strict verification against the actual TypeScript source code and Zod schemas in `packages/decomposer/src/`, `packages/repository-index/src/`, and `@manyhands/contracts` revealed two major typing/signature inaccuracies in `packages/decomposer/README.md` and one minor non-existent interface reference in `packages/repository-index/README.md`. Specifically, snippet 1 in the decomposer README accesses a non-existent property `result.continuation.token` which fails TypeScript typechecking, and the symbol catalog cites non-existent type names `GranularityStrategyInput` and `GranularityStrategyDecision`.

---

## Findings

### [Major] Finding 1: Property `result.continuation.token` does not exist on `PlanningContinuation`

- **What**: In `packages/decomposer/README.md` (lines 136 and 233), the text and example code treat `PlanningContinuation` as having a `.token` string property:
  ```typescript
  console.log("Token de continuación:", result.continuation.token);
  ```
- **Where**: `packages/decomposer/README.md:136`, `packages/decomposer/README.md:233`.
- **Why**: `PlanningContinuation` is defined in `@manyhands/contracts/src/planning.ts:58-63` as:
  ```typescript
  export const PlanningContinuationSchema = z.object({
    requestDigest: CanonicalDigestSchema,
    revisionDigest: CanonicalDigestSchema,
    decisionSetDigest: CanonicalDigestSchema
  }).strict();
  export type PlanningContinuation = z.infer<typeof PlanningContinuationSchema>;
  ```
  It contains `requestDigest`, `revisionDigest`, and `decisionSetDigest`. Accessing `.token` results in TypeScript error `TS2339: Property 'token' does not exist on type 'PlanningContinuation'`.
- **Suggestion**: Update snippet 1 in `packages/decomposer/README.md` to access the valid properties or print the continuation object:
  ```typescript
  } else if (result.kind === "needs_input") {
    console.log("Se requiere clarificación humana:", result.decisions);
    console.log("Digest de continuación:", result.continuation.revisionDigest);
  }
  ```
  And in line 136, rephrase to indicate that it generates a deterministic continuation record (`PlanningContinuation`).

---

### [Major] Finding 2: Inaccurate Signatures and Non-Existent Types for `selectGranularityStrategy`

- **What**: In `packages/decomposer/README.md` (line 178), the symbol catalog lists:
  `| selectGranularityStrategy | (input: GranularityStrategyInput) => GranularityStrategyDecision |`
- **Where**: `packages/decomposer/README.md:178`.
- **Why**: The types `GranularityStrategyInput` and `GranularityStrategyDecision` do not exist in `packages/decomposer/src/granularity/strategy-selector.ts` or anywhere in the codebase. The actual signature exported by `strategy-selector.ts:70-72` is:
  ```typescript
  export function selectGranularityStrategy(
    input: SelectGranularityStrategyInput
  ): GranularityStrategyResult
  ```
- **Suggestion**: Update line 178 of `packages/decomposer/README.md` to:
  `| selectGranularityStrategy | (input: SelectGranularityStrategyInput) => GranularityStrategyResult | Evalúa condiciones A y C para aplicar la política de granularidad. |`

---

### [Minor] Finding 3: Reference to Non-Existent Interface `BuildResourceCatalogInput`

- **What**: In `packages/repository-index/README.md` (line 135), the symbol catalog lists:
  `| buildResourceCatalog | (input: BuildResourceCatalogInput) => ResourceCatalog |`
- **Where**: `packages/repository-index/README.md:135`.
- **Why**: `resource-catalog.ts:267-271` defines `buildResourceCatalog` with an inline parameter type:
  ```typescript
  export function buildResourceCatalog(input: {
    model: RepositoryModel;
    repositoryContentDigest: string;
    aliases?: readonly ResourceAliasInput[];
  }): ResourceCatalog
  ```
  There is no exported interface named `BuildResourceCatalogInput`.
- **Suggestion**: Update line 135 of `packages/repository-index/README.md` to:
  `| buildResourceCatalog | (input: { model: RepositoryModel; repositoryContentDigest: string; aliases?: readonly ResourceAliasInput[] }) => ResourceCatalog | Constructor canónico del catálogo a partir de un RepositoryModel. |`

---

## Verified Claims

| # | Claim | Verification Method | Status |
|---|---|---|---|
| 1 | `PlanningEngine`, `compilePlan`, `verifyPlan`, `GranularityPolicy` 4.0 exist and are exported from `@manyhands/decomposer` | Inspected `packages/decomposer/src/index.ts` lines 1567-1569 and barrel exports. | **PASS** |
| 2 | Verifier implements exactly 8 formal categories (`verifyHierarchy`, `verifyCriteria`, `verifyUnits`, `verifyArtifacts`, `verifySeams`, `verifyResources`, `verifyPaths`, `verifyEvidence`/`validateProofCoverage`) | Inspected `packages/decomposer/src/compiler/plan-verifier.ts`. All 8 function routines verified. | **PASS** |
| 3 | `describeDecision("split", reasons, true)` returns the exact English sentence documented | Inspected `packages/decomposer/src/granularity/granularity-policy.ts:91-110`. Sentence formatting matches character-for-character. | **PASS** |
| 4 | `RepositoryModel` builds directly from Git object store hashes (`oid`, `treeSha`) with bounded concurrency | Inspected `packages/repository-index/src/repository-model.ts`. Verified `listGitTree` and `readBlob` implementation. | **PASS** |
| 5 | `ResourceCatalog` handles `origin: "declared"`, aliases, and `overlaps` (`"yes" \| "no" \| "unknown"`) | Inspected `packages/repository-index/src/resource-catalog.ts:24-25, 185-242`. Verified fail-closed logic. | **PASS** |
| 6 | `RepositoryQuery` enforces `RepositoryQueryBudget` and marks truncated answers with `EpistemicAssessment` | Inspected `packages/repository-index/src/repository-query.ts` and `@manyhands/shared/src/index.ts:13-20`. | **PASS** |
| 7 | `FastRepositoryIndexer` uses Ripgrep and profile constant `INDEXER_PROFILE = "exports-only-v2-size-metrics-baseline-without-pm"` | Inspected `packages/repository-index/src/fast-indexer.ts:46`. | **PASS** |
| 8 | All test suites cited in both READMEs exist and pass | Executed `pnpm test tests/stage5-planning-engine.test.ts ...` (69 passed) and `pnpm test tests/repository-query.test.ts ...` (28 passed). | **PASS** |
| 9 | Both packages typecheck and build cleanly | Executed `pnpm --filter @manyhands/decomposer typecheck`, `pnpm --filter @manyhands/repository-index typecheck`, and `tsup` build commands. | **PASS** |
| 10 | Relative links to `docs/plans/2026-08-12-correctness-first-system-redesign.md` resolve correctly | Inspected target path `../../docs/plans/2026-08-12-correctness-first-system-redesign.md` from packages root. | **PASS** |

---

## Adversarial Stress-Test & Edge Case Analysis

1. **Copy-Paste Developer Experience Attack**:
   - If a developer copies Snippet 1 from `packages/decomposer/README.md` into a TypeScript project and encounters a `needs_input` result, `result.continuation.token` will fail compilation. This is a critical usability gap for public documentation.
2. **Schema Invariant Attack**:
   - Checked whether `PlanningBudget` schema fields match the README snippet. Verified `PlanningBudgetSchema` in `@manyhands/contracts` has exact same fields: `modelCalls`, `repositoryQueries`, `queryBytes`, `revisions`, `repairs`, `expansions`.
3. **Epistemic Model Consistency**:
   - Checked whether `searchResult.epistemic.state` in `packages/repository-index/README.md` snippet 3 matches the discriminated union. Verified `EpistemicAssessmentSchema` discriminates on `state: "known" | "partial" | "unknown" | "conflicting"`.
4. **Integrity & Facade Check**:
   - Verified that neither package relies on mocked facades in production code or hardcoded test returns. All tests perform real Git commands (`git cat-file`, `git ls-tree`), Ripgrep invocations, AST parsing with `typescript.createSourceFile`, and real SHA-256 canonical digest calculations.

---

## Coverage Gaps

- None. All 50 source files across both packages and all exported symbols were cross-referenced.

---

## Unverified Items

- None. All commands and assertions were independently executed and verified.
