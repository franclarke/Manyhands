# 0021 · The orchestrator makes commits, not Codex

## Status

Accepted. Types defined in `AgentExecutionResultSchema` (`packages/execution-core`).

## Context

In a multi-agent worktree setup, commit authorship and timing matter for integration (cherry-pick). If agents make their own commits with arbitrary messages and timing, the orchestrator loses control over the commit graph and cannot reliably integrate results.

## Decision

- **The orchestrator is the sole committer.** After Codex completes, the orchestrator:
  1. Runs `git diff HEAD` to capture changes.
  2. Validates scope (changed files within allowed paths).
  3. Runs validation commands (tests, typecheck).
  4. If all checks pass, creates a single commit with a structured message.
- Codex CLI should never make commits. The `bypassApprovals: true` flag helps but does not guarantee this — the agent could use `git commit` as a tool call.
- If Codex does commit unexpectedly, the orchestrator detects it by comparing `git rev-parse HEAD` before and after execution. The field `agentCommittedUnexpectedly: true` is set on the result.
- Policy for unexpected commits is handled by ADR-0022.

## Consequences

Positive:
- Consistent commit messages and structure across all leaf executions.
- The orchestrator controls the commit graph — essential for cherry-pick integration.
- Scope and validation checks happen before any commit, preventing invalid code from entering the history.

Negative / accepted:
- The agent's work is ephemeral until the orchestrator commits — a crash between Codex completion and commit would lose work. Mitigated: the diff is captured and persisted to the trace store before commit.
- Structured commit messages lose any agent-authored context. Accepted: the trace store carries the full execution record.

## Alternatives considered

- **Let Codex commit, then squash**: rejected — squashing after the fact adds complexity and risks merge conflicts.
- **Pre-commit hook to block agent commits**: considered — fragile if the agent disables hooks. Detection + policy is more robust.

## References

- Decision D6 in `CLAUDE.md`
- `packages/execution-core/src/types.ts`: `AgentExecutionResultSchema.agentCommittedUnexpectedly`
- `packages/execution-core/src/errors.ts`: `UnexpectedCommitError`
