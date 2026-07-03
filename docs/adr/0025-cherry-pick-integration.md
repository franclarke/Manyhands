# 0025 · Cherry-pick integration with Codex repair fallback

## Status

Accepted. Types defined in `IntegrationResultSchema`, `IntegrationStatusSchema`, `ConflictDetailSchema` (`packages/execution-core`).

## Context

When multiple leaf tasks complete under a composite parent, their changes must be integrated into a single branch. The children work in isolated worktrees branched from the same base commit, so their changes may conflict if they touch overlapping files.

## Decision

Integration uses **cherry-pick** of child commits onto the parent's branch:

1. For each completed child (in topological order of dependencies):
   - `git cherry-pick <child-commit-sha>` onto the parent integration branch.
   - If clean: continue to next child. Trace: `cherry_pick_attempted`.
   - If conflict: trace `cherry_pick_conflict`, attempt repair.

2. **Conflict repair** via Codex CLI:
   - Abort the failed cherry-pick (`git cherry-pick --abort`).
   - Invoke Codex with a repair prompt containing: the conflicting diff, the parent branch context, and the child's intent/goal.
   - Codex produces a resolution. The orchestrator validates scope and runs parent validation.
   - Success → `codex_repair_success`. Failure → `codex_repair_failed`.
   - **Bounded repair budget per integration**. Each conflicting child may be
     repaired independently, preserving one commit per child, until the
     configured `maxRepairsPerIntegration` budget is exhausted (default: 4).
     The budget replaces the previous "maximum 1 repair per integration" rule:
     shared files such as `package.json` and config files can legitimately
     conflict in more than one child. No recursive retries beyond each repair's
     own bounded validation passes.

3. **Integration result**:
   - All children cherry-picked cleanly → `success`.
   - At least one repair succeeded → `codex_repair_success`.
   - Any repair failed → `codex_repair_failed` (integration halts).
   - Any child has `status !== "success"` → `child_failed` (skip integration).

## Consequences

Positive:
- Cherry-pick preserves individual commit history — each child's work is a discrete commit on the parent branch.
- Codex repair provides a semantic merge capability that goes beyond textual conflict resolution.
- The explicit repair budget prevents infinite loops while allowing multiple
  shared-file conflicts in one composite.

Negative / accepted:
- Cherry-pick order matters when there are inter-child dependencies. Mitigation: topological sort based on `graph.dependencies`.
- Codex repair costs tokens and adds latency. Accepted: the alternative (manual resolution) costs more human time.
- If repair fails, the entire composite fails. Accepted: partial integration is harder to reason about than clean failure.

## Alternatives considered

- **`git merge` instead of cherry-pick**: rejected — merge creates merge commits that complicate the history and make rollback harder.
- **Manual conflict resolution**: rejected for MVP — the goal is full automation. Manual mode can be added later as a fallback.
- **Rebase-based integration**: rejected — rebase rewrites history, which conflicts with the orchestrator's commit tracking.

## References

- Decision D8 in `CLAUDE.md`
- `packages/execution-core/src/types.ts`: `IntegrationResultSchema`, `IntegrationStatusSchema`, `ConflictDetailSchema`
- `packages/execution-core/src/errors.ts`: `IntegrationError`
- `packages/trace-store/src/index.ts`: `cherry_pick_attempted`, `cherry_pick_conflict`, `codex_repair_started`
