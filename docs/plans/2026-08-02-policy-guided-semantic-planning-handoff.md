# Policy-guided semantic planning: continuation handoff

## Status

Implementation paused on 2026-08-02 because the user requested a low-credit
checkpoint. No experimental run was started and no G6 input, preregistration,
oracle, result, or evidence was changed.

Continue in the preserved worktree:

- worktree: `C:\Users\franc\.codex\tmp\manyhands-policy-guided-planning`
- branch: `codex/policy-guided-planning`
- current green implementation commit: `5dadc9e`
- original checkout is currently on `codex/system-reliability-redesign`; do not
  switch, reset, clean, delete, or reuse that checkout for this work

The branch is intentionally not integrated into `main` and must not be pushed.

## Completed

The branch contains these ordered commits:

1. `cb8b25e docs(planning): design policy-guided candidates`
2. `d3bd0b1 fix(planning): preserve acceptance ownership`
3. `abd83d2 feat: add validated planning envelope candidates`
4. `8d3e8de feat(planning): guide semantic candidates`
5. `5dadc9e feat(planning): enforce canonical candidate gates`

Implemented behavior:

- the selector no longer copies a root/global acceptance intent into every
  selected leaf;
- plan criticism accepts an integration composite as the valid owner of a
  global criterion;
- `PlanningEnvelope` carries the policy version, candidate budget, execution
  budgets, and hard-gate requirements before model generation;
- `WorkBreakdownPlanner.planCandidates` requests two or three named alternatives
  and deduplicates repeated canonical trees;
- acceptance ownership and seam specifications live canonically inside
  `WorkBreakdown`, rather than in a parallel candidate wrapper;
- candidate validation fails closed for candidate-count violations, incomplete
  ownership, global criteria copied into leaves, incomplete seam specifications,
  missing producer-file materialization, and compiler rejection;
- candidate selection filters compiler-invalid candidates before deterministic
  policy ranking.

The obsolete parallel `GranularityPlanningBrief` implementation and its test
were removed in `5dadc9e`; `PlanningEnvelope` is the single pre-planning policy
contract.

## Verification already performed

From the preserved worktree:

```text
pnpm build
PASS (exit 0, 65.1 s on the last conclusive run)

pnpm exec vitest run tests/planning-envelope.test.ts tests/decomposer-work-breakdown.test.ts
PASS: 2 files, 41 tests
```

The next vertical regression is intentionally red:

```text
pnpm exec vitest run tests/planning-v2-adaptive.test.ts
FAIL: 1 failed, 2 passed
```

Expected failure:

```text
expected 'single-candidate planning should not run when planCandidates is available' to be undefined
```

This proves the productive host still calls `plan()` and ignores the new
`planCandidates` capability. The failing test is
`tests/planning-v2-adaptive.test.ts` and should be committed with this handoff as
a deliberate red checkpoint.

## Remaining implementation, in required order

### 1. Make the vertical regression green

Modify `apps/web/src/lib/server/runs/v2/planning-host.ts`:

- add an optional `planCandidates(input, count, observer)` dependency;
- build `PlanningEnvelope` immediately after repository inspection, using the
  exact limits from `PILOT_UTILITY_POLICY` and a maximum of three candidates;
- attach that envelope to `WorkBreakdownPlannerInput` before generation;
- when `planCandidates` exists and the run is not experimental, generate and
  canonicalize the candidate set;
- preserve a planner clarification as a stopped planning decision; never answer
  it automatically;
- run `selectGranularityStrategy` for every structurally valid candidate;
- compile every candidate frontier independently and record thrown compiler
  diagnostics instead of failing the whole batch on the first rejection;
- pass compiler results to `selectCandidatePlan` and continue with the selected
  candidate plus its already compiled graph;
- use the selected candidate root assessment's existing `splitAdvantage` as the
  candidate score. Do not change the utility formula or `minimumAdvantage`;
- if no candidate survives, perform one bounded candidate-set replan with the
  concrete gate/compiler findings, then fail and preserve those findings if the
  second set also fails;
- keep the current single-candidate path as compatibility fallback when the
  optional dependency is absent.

The `experimentalCandidate` path is frozen historical/G6 replay. It must remain
one candidate, must not call `planCandidates`, and must not be regenerated.

### 2. Activate the product adapter

Modify `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts` to pass:

```ts
planCandidates: (input, count, observer) =>
  planner.planCandidates(input, count, observer)
```

Approval/revision adapters can omit the optional dependency.

### 3. Make explicit acceptance ownership survive frontier selection

Add regressions before the fix. At present, relation endpoints are remapped when
a composite collapses, but `acceptanceOwnership.ownerUnitKey` and seam ownership
are not remapped. Also, the contract compiler still derives ownership from old
intent references and does not consume the new explicit matrix.

Required changes:

- remap explicit owners to the nearest selected ancestor in
  `packages/decomposer/src/granularity/strategy-selector.ts`;
- remove or normalize seam ownership when its seam disappears after collapse;
- in the contract compiler, use explicit ownership when present and retain the
  historical derived-allocation fallback only for old persisted breakdowns;
- prove with tests that local, seam, and global criteria each compile exactly
  once at the intended owner, including after a frontier collapse.

Relevant tests and modules:

- `tests/contract-acceptance-allocation.test.ts`
- `tests/granularity-utility-policy.test.ts`
- `packages/decomposer/src/compiler/acceptance-allocation.ts`
- `packages/decomposer/src/compiler/contract-compiler.ts`
- `packages/decomposer/src/granularity/strategy-selector.ts`

### 4. Persist candidate evaluation evidence

Extend `planning.granularity_strategy_selected` with an optional, backward-
compatible `candidateEvaluations` array containing candidate ID/hash,
eligibility, score, and diagnostics. Persist the same information in the
granularity diagnostic JSON. Update:

- `packages/run-coordinator/src/domain/events.ts`
- `packages/run-coordinator/src/reducer.ts` only if projection state needs it
- `apps/web/src/lib/server/runs/v2/planning-host.ts`
- `tests/run-granularity-strategy-selected.test.ts`

Do not overwrite or reinterpret adverse candidate results.

### 5. Reconcile authoritative documentation

The design and implementation plan still mention the removed
`GranularityPlanningBrief` in places. Update them to the canonical
`PlanningEnvelope`/`WorkBreakdown` design, then update:

- `docs/system/03-decomposer.md`
- `docs/DECISIONS.md`
- `docs/adr/0012-utility-based-granularity-selection.md`

State explicitly that this is a product successor to G6 and does not modify G6.
Include a final `Que no se concluye` section: declared candidate dependencies
can be validated, but the system cannot prove that an LLM disclosed every
latent semantic dependency.

## Final verification and integration

For every behavioral step, keep strict TDD: reproduce red for the correct
reason, then implement the smallest root fix. Before any test run after source
changes, run `pnpm build`.

Final gates:

```text
pnpm build
pnpm exec vitest run tests/planning-envelope.test.ts tests/decomposer-work-breakdown.test.ts tests/planning-v2-adaptive.test.ts tests/granularity-utility-policy.test.ts tests/contract-acceptance-allocation.test.ts tests/run-granularity-strategy-selected.test.ts
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm web:build
```

Before each commit, normalize touched text files to LF and verify both
`git diff --check` and `git diff --numstat`. Make small local commits only. Do
not push. Do not delete the worktree, pools, journals, clones, or run artifacts.

Only integrate after every gate is green. Re-inspect the real `main` pointer at
that time because another task is actively changing the original checkout; do
not assume `main` or the original working tree is unchanged.
