# 0022 · Policy for unexpected agent commits

## Status

Accepted. Types defined in `ExecutionConfigSchema` and `UnexpectedCommitError` (`packages/execution-core`).

## Context

Despite the orchestrator being the designated committer (ADR-0021), Codex CLI might create commits during execution — e.g., using `git commit` as a tool call. The orchestrator detects this by comparing HEAD before and after. A policy is needed: should it accept the agent's commit or reject the result?

## Decision

- The policy is configurable via `ExecutionConfig.unexpectedCommitPolicy`:
  - **`"reject"` (default)**: The result is discarded, the worktree is cleaned, and the task fails with `UnexpectedCommitError`. The trace records `unexpected_commit_detected`.
  - **`"accept"`**: The agent's commit is accepted as-is. The orchestrator still validates scope and runs validation commands against the committed state. If validation fails, the task still fails.
- The policy applies uniformly to all tasks in a run. Per-task override is not supported in V1.

## Consequences

Positive:
- Default `reject` enforces orchestrator commit control — prevents the agent from bypassing scope checks and validation.
- `accept` mode provides an escape hatch for advanced users who trust their agents or need agent-authored commit messages.
- Detection is reliable — SHA comparison is deterministic.

Negative / accepted:
- `reject` means wasted compute when the agent commits. Accepted: better than accepting unvalidated changes.
- No per-task granularity in V1. Accepted: simplicity over flexibility for now.

## Alternatives considered

- **Auto-reset the agent commit and re-apply as orchestrator commit**: rejected — `git reset` + re-staging is fragile and might lose staged hunks.
- **Amend the agent commit with orchestrator metadata**: rejected — modifying the agent's commit obscures the audit trail.

## References

- Extension of Decision D6 in `CLAUDE.md`
- `packages/execution-core/src/types.ts`: `UnexpectedCommitPolicySchema`, `ExecutionConfigSchema`
- `packages/execution-core/src/errors.ts`: `UnexpectedCommitError`
- ADR-0021
