# 01 — Replace productive planning with SemanticPlanning

**What to build:** implement the confirmed `PlanningModule` seam and switch the
productive V2 host from model-authored `CandidatePlan` to deterministic
`SemanticPlanDraft -> SemanticPlan -> ExecutionCut -> GraphRevision`.

**Blocked by:** none.

**Status:** agent-working

- [x] RED proves product mode continues with one safe candidate.
- [x] GREEN returns `ready` with degraded comparison and durable evidence.
- [x] RED proves experiment mode requires two comparable candidates.
- [x] GREEN distinguishes proposal target, safe quorum and comparable quorum.
- [x] RED proves the model cannot author snapshot or canonical identity.
- [x] GREEN derives stable plan/module/seam identity from frozen inputs.
- [x] RED proves a durable commit failure cannot return success.
- [x] GREEN makes planning completion transactional under the run fence.
- [x] RED/GREEN replay uses recorded proposal receipts without a model call.
- [x] Productive Graph Compiler consumes the canonical semantic plan and cut.
- [x] Productive host no longer emits or consumes new `CandidatePlan` payloads.
- [x] Historical G6/G7 evidence remains byte-for-byte unchanged.
- [ ] Focused, affected and broad gates pass in the isolated worktree.
- [x] Standards and Spec reviews pass before integration.

## Verification evidence

- PASS — semantic/affected matrix: 8 files, 52 tests.
- PASS — broad suite excluding the legacy active-dist freeze: 229 files,
  1,611 tests, 2 skipped.
- PASS — decomposer and run-coordinator typechecks/builds; web typecheck;
  package build; scoped lint.
- FAIL (preserved) — the historical wide-graph oracle requires the active
  ignored `packages/decomposer/dist/index.js` to equal the superseded frozen
  policy bundle (`d2ad49...`); the current semantic build is `06183b...`.
- FAIL (environment) — `web:build` cannot load the Windows
  `@tailwindcss/oxide` optional native binding.
- NOT RUN — bounded live Warehouse preflight; deferred to avoid model spend
  until the branch is integrated and the two non-code gates are resolved.
