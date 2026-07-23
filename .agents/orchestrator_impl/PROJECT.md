# Project: ManyHands Remediation Plan Canonicalization & Wave 0 Execution

## Architecture
- Root repository: `c:\Users\franc\Documents\Proyectos\Manyhands`
- Planning artifacts: `docs/audits/production-readiness/planning/`
- Execution packages affected in Wave 0:
  - `packages/execution-core/src/run/grounding-agent.ts` (MH-REM-001)
  - `packages/run-store/src/jsonl-event-store.ts` (MH-REM-002)
  - `apps/web` UI test suite (MH-REM-003)
- Validation script: `scripts/validate-remediation-plan.ts`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Planning Canonicalization & Consistency Gate | Reconcile backlog, ID migration ledger, create and pass validation script | none | DONE |
| 2 | Wave 0 Implementation | Implement MH-REM-001, MH-REM-002, MH-REM-003 with tests | M1 | DONE |
| 3 | Full Verification & Final Audit | Run pnpm test, typecheck, build; conduct Forensic Audit | M2 | DONE |
| 4 | Typecheck Remediation | Fix all `pnpm typecheck` errors across tests/ and packages | M3 | IN_PROGRESS |

## Interface Contracts & Verification Specifications
### Milestone 4: Typecheck Remediation
- Target: Fix all 7 TypeScript error clusters in `tests/` reported by Victory Auditor:
  1. `tests/grounding-agent-dirty-workspace.test.ts`
  2. `tests/execution-core-skeleton-scaffolder.test.ts`
  3. `tests/granularity-mapping.test.ts`
  4. `tests/helpers/workspace-reference-child.ts`
  5. `tests/run-coordinator-execution.test.ts`
  6. `tests/task-graph-graft.test.ts`
  7. `tests/validation-recipe.test.ts`
- Verification requirement: `pnpm typecheck` must pass with 0 errors, and `pnpm test` must continue to pass with 0 failures.
