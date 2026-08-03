# Policy-guided Semantic Planning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the adaptive policy constrain semantic planning before generation and choose only among compiler-valid candidate plans.

**Architecture:** Add a deterministic `PlanningEnvelope` and bounded candidate generation ahead of the existing selector. Preserve one canonical `WorkBreakdown`, derive acceptance ownership without propagating IDs, reject semantic gate failures, compile each candidate's selected frontier independently, and rank only viable results.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm monorepo, V2 append-only run events.

---

### Task 1: Preserve acceptance ownership

**Files:**
- Modify: `packages/decomposer/src/compiler/acceptance-allocation.ts`
- Modify: `packages/decomposer/src/granularity/strategy-selector.ts`
- Modify: `packages/decomposer/src/critics/review.ts`
- Test: `tests/contract-acceptance-allocation.test.ts`
- Test: `tests/granularity-utility-policy.test.ts`

**Steps:**

1. Change the root-only regression to assert that a split keeps the global ID
   only on the composite and local IDs only on their authored leaves.
2. Run `pnpm exec vitest run tests/granularity-utility-policy.test.ts` and verify
   it fails because `propagateAncestorAcceptance` still duplicates the ID.
3. Remove propagation, add detailed leaf/seam/global allocation, and make
   completeness inspect the derived owner instead of requiring every intent on
   a leaf.
4. Add a regression proving one local criterion remains on its leaf while a
   root-only criterion compiles once at the integration owner.
5. Build, rerun both focused suites, and commit.

### Task 2: Put policy constraints before the model

**Files:**
- Modify: `packages/decomposer/src/planner/planning-envelope.ts`
- Modify: `packages/decomposer/src/planner/work-breakdown.ts`
- Modify: `packages/decomposer/src/planner/prompt.ts`
- Modify: `packages/decomposer/src/index.ts`
- Test: `tests/decomposer-work-breakdown.test.ts`
- Test: `tests/planning-envelope.test.ts`

**Steps:**

1. Add a failing prompt test that expects policy version, exact leaf budgets,
   candidate identity, acceptance rules, and hard gates before generation.
2. Run the focused tests and verify the prompt omits that brief.
3. Implement `createPlanningEnvelope` and typed candidate request input.
4. Add `WorkBreakdownPlanner.planCandidates`, using candidate-specific cache
   keys, prior hashes, deterministic deduplication, and bounded request count.
5. Build, rerun the focused suites, and commit.

### Task 3: Reject semantically unsafe candidates

**Files:**
- Create: `packages/decomposer/src/granularity/candidate-validation.ts`
- Modify: `packages/decomposer/src/planner/schema.ts`
- Modify: `packages/decomposer/src/planner/prompt.ts`
- Modify: `packages/decomposer/src/compiler/graph-compiler.ts`
- Test: `tests/granularity-candidate-validation.test.ts`

**Steps:**

1. Add failing tests for ambiguous multi-branch acceptance and for a
   `producer_files` seam without materialized artifacts for all consumers.
2. Run the new suite and verify the missing validator is the failure.
3. Add backward-compatible `CandidateSeam.delivery`, ownership gates, relation
   materialization gates, and `assertGranularityCandidate` at compiler entry.
4. Add passing controls for leaf, seam, and global acceptance ownership.
5. Build, rerun the suite plus Graph Compiler tests, and commit.

### Task 4: Select among compiler-valid candidates

**Files:**
- Create: `packages/decomposer/src/granularity/candidate-selector.ts`
- Modify: `apps/web/src/lib/server/runs/v2/planning-host.ts`
- Modify: `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`
- Modify: `packages/run-coordinator/src/domain/events.ts`
- Modify: `packages/run-coordinator/src/reducer.ts`
- Test: `tests/granularity-candidate-selector.test.ts`
- Test: `tests/planning-v2-adaptive.test.ts`
- Test: `tests/run-granularity-strategy-selected.test.ts`

**Steps:**

1. Add a failing pure-selector test proving an invalid higher-utility candidate
   cannot beat a lower-utility valid candidate.
2. Add a failing vertical test with two candidates: one compiler rejection and
   one successful candidate that reaches approval.
3. Implement deterministic viable-only ranking and candidate evaluation
   persistence.
4. Wire productive V2 planning to request up to three candidates and perform
   one bounded replan only when none is viable. Keep frozen experimental replay
   at one unchanged candidate.
5. Build, run focused vertical/replay suites, and commit.

### Task 5: Verify and document the product boundary

**Files:**
- Modify: `docs/system/03-decomposer.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/adr/0012-utility-based-granularity-selection.md`

**Steps:**

1. Document the brief, candidate gates, viable-only selection, acceptance
   ownership, bounded replan, and declared limitation.
2. Run `pnpm build` before any tests.
3. Run focused tests, `pnpm test`, package typechecks, web typecheck, and
   `pnpm web:build`.
4. Normalize changed text files to LF, run `git diff --check`, inspect
   `git diff --numstat`, and commit locally without pushing.
