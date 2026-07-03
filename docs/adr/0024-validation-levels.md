# 0024 · Validation at three levels: leaf, parent, run

## Status

Accepted. Schemas defined in `ExecutionValidationCommandSchema` (`packages/contracts`).

## Context

Validation commands (tests, typecheck, lint) need to run at different points in the execution lifecycle. A leaf task's tests verify that individual work is correct. A composite's parent-level validation verifies that integrated children work together. Run-level validation verifies the entire deliverable. Each level has different requirements for timeout, working directory, and blocking behavior.

## Decision

Three validation levels, each stored as `ExecutionValidationCommand[]` on the contract:

1. **`leafValidationCommands`** — run after each leaf task completes, before the orchestrator commits. Working directory is the leaf's worktree. Failure → task status `validation_failed`.
2. **`parentValidationCommands`** — run after all children of a composite are integrated (cherry-picked). Working directory can be the integration worktree or repo root. Failure → integration status `validation_failed`.
3. **`runValidationCommands`** — run after all tasks complete and the final integration is done. Working directory is the repo root. Failure → run status `failed` with validation details.

Each `ExecutionValidationCommand` specifies:
- `command`: the executable (e.g., `"pnpm"`).
- `args`: arguments array (e.g., `["test", "--run"]`).
- `timeoutMs`: per-command timeout (default 60s).
- `cwd`: `"worktree"` (task's worktree) or `"repo-root"` (original repository).

## Consequences

Positive:
- Progressive validation catches issues at the earliest possible point.
- Per-level configuration allows appropriate timeouts (leaf tests are fast, run-level integration tests may be slow).
- The existing `validationCommands` field in contracts is untouched — V2 fields are additive.

Negative / accepted:
- Three levels of validation increase total execution time. Mitigated: each level is optional (empty array skips validation).
- `cwd: "repo-root"` for leaf validation doesn't make sense. Accepted: the schema allows it but the executor should warn.

## Alternatives considered

- **Single `validationCommands` for all levels**: rejected — the same test suite doesn't apply at leaf and run levels.
- **Validation as a separate pipeline stage**: rejected — validation is tightly coupled to the execution result and must gate commits.

## References

- `packages/contracts/src/index.ts`: `ExecutionValidationCommandSchema`, `AgentTaskContractSchema.leafValidationCommands`, `.parentValidationCommands`, `.runValidationCommands`
- `packages/execution-core/src/types.ts`: `ValidationRunResultSchema`
- `packages/execution-core/src/errors.ts`: `ExecutionValidationError`
