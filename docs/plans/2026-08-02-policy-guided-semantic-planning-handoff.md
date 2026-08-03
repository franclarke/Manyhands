# Policy-guided semantic planning: continuation handoff

## Status

Implementation completed on 2026-08-02 in the preserved worktree. No
experimental run was started and no G6 input, preregistration, oracle, result,
or evidence was changed.

Continue in the preserved worktree:

- worktree: `C:\Users\franc\.codex\tmp\manyhands-policy-guided-planning`
- branch: `codex/policy-guided-planning`
- current source implementation commits: `ae9c495`, `9573a25`
- historical red checkpoint: `e55e6d8`
- original checkout is currently on `codex/system-reliability-redesign`; do not
  switch, reset, clean, delete, or reuse that checkout for this work

The branch is intentionally not integrated into `main` and must not be pushed.

## How the next agent must resume

Use the existing worktree; do not create a second clone and do not run from the
original checkout:

```powershell
Set-Location 'C:\Users\franc\.codex\tmp\manyhands-policy-guided-planning'
git switch codex/policy-guided-planning
git status --short
git log --oneline --decorate -8
Get-Content docs/plans/2026-08-02-policy-guided-semantic-planning-handoff.md
```

Tracked source status is clean after the implementation commits; disposable
dependency stores created for isolated verification may remain untracked. Do
not launch a ManyHands run from this handoff. Do not answer planner
clarification questions automatically. Preserve all adverse compiler, planner,
and run evidence.

Before changing source, read the repository `AGENTS.md` and the applicable
planning docs. Before each test command after a source change, run
`pnpm build`. Keep each fix in a small local commit and leave this handoff
updated if the order or blocker changes.

## Completed

The historical branch commits before closure were superseded by the following
current implementation commits:

1. `d798300 feat(planning): activate semantic candidate selection`
2. `0bdcef6 fix(planning): preserve explicit acceptance ownership`
3. `67e2c70 feat(planning): persist candidate evaluation evidence`
4. `eece61b docs(planning): reconcile envelope and G6 boundary`
5. `ffea620 fix(planning): persist strategy before compiler review`
6. `ae9c495 fix(planning): enforce canonical ownership gates`
7. `9573a25 fix(planning): preserve candidate evaluation evidence`

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

## Verification performed

From the preserved worktree:

```text
pnpm build
PASS (exit 0, Node 22 isolated runtime)

pnpm -r --filter "./packages/*" typecheck
PASS: 12 packages
```

Final focal suite:

`PASS: 6 files, 80 tests`

Full `pnpm test`:

`PARTIAL: 1566 passed, 2 skipped, 13 failures/errors`

The remaining failures are environmental or frozen adverse evidence: missing
web `next/server` dependencies in the isolated store, a hardcoded missing
`esbuild@0.21.5` path in a multiprocess test, safe.directory ownership in an
asset test, and the frozen wide-graph/G6 hash mismatch. No G6 oracle or evidence
was changed to make them green.

## Implemented checklist

The numbered implementation steps below are complete: bounded candidate
generation, deterministic strategy and compiler eligibility, explicit ownership
and seam gates, candidate evaluation persistence across selected, failed, and
clarification outcomes, product adapter wiring, and canonical documentation.
The `experimentalCandidate` path remains frozen historical/G6 replay.

<!-- Historical implementation steps retained below for traceability. -->

## Historical implementation steps

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

## Required final integration into `main`

Integration is part of completion, not optional cleanup. Only do it after all
implementation and final verification commands above pass:

1. From the preserved worktree, record the final branch and status:

   ```powershell
   Set-Location 'C:\Users\franc\.codex\tmp\manyhands-policy-guided-planning'
   git status --short
   git log --oneline --decorate -8
   git diff --check
   ```

2. Inspect the real checkout. It must be clean before switching it to `main`:

   ```powershell
   git -C 'C:\Users\franc\Documents\Proyectos\Manyhands' status --short
   git -C 'C:\Users\franc\Documents\Proyectos\Manyhands' branch --show-current
   git -C 'C:\Users\franc\Documents\Proyectos\Manyhands' log main -1 --oneline
   ```

   If it is dirty, or if another agent is actively using that checkout, stop
   and report the condition. Do not reset, clean, stash globally, or overwrite
   another agent's changes.

3. Once the checkout is confirmed clean and available, fast-forward `main` to
   the completed branch without pushing:

   ```powershell
   git -C 'C:\Users\franc\Documents\Proyectos\Manyhands' switch main
   git -C 'C:\Users\franc\Documents\Proyectos\Manyhands' merge --ff-only codex/policy-guided-planning
   git -C 'C:\Users\franc\Documents\Proyectos\Manyhands' status --short
   git -C 'C:\Users\franc\Documents\Proyectos\Manyhands' log -3 --oneline --decorate
   ```

   If `--ff-only` refuses because `main` advanced, do not force the merge and
   do not rebase destructively. Preserve the branch, report the exact diverging
   commits, and let the user choose the integration strategy.

4. In the final report, include the integrated commit, all verification results,
   the fact that no push occurred, and any remaining limitation. Do not delete
   the feature worktree or its artifacts unless the user explicitly requests
   cleanup.
