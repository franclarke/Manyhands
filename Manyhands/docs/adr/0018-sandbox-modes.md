# 0018 · Sandbox modes for Codex CLI execution

## Status

Accepted. Implemented in `ExecutionConfigSchema` and `CodexCliExecutorOptionsSchema` (`packages/execution-core`).

## Context

Codex CLI supports two sandbox modes that control what the agent process can do on the filesystem. ManyHands must choose a safe default while allowing opt-in escalation for tasks that genuinely need broader access (e.g., installing system packages, modifying dotfiles outside the worktree).

## Decision

- Default sandbox mode is **`workspace-write`**: the agent can only read/write within the git worktree assigned to its task. This is enforced via `codex exec --sandbox workspace-write`.
- **`danger-full-access`** requires explicit opt-in at the contract level (`AgentTaskContract.executionScope`) AND user confirmation at run approval time. It is never the automatic default.
- The mode is configurable per-run via `ExecutionConfig.sandboxMode` and per-task via `CodexCliExecutorOptions.sandboxMode`. Task-level overrides are only allowed when the run-level config permits escalation.

## Consequences

Positive:
- Safe by default — an LLM agent cannot modify files outside its worktree unless the user explicitly allows it.
- Per-task granularity allows mixed-mode runs where most tasks are sandboxed but one needs broader access.

Negative / accepted:
- Tasks that need to install dependencies (`npm install`) may fail under `workspace-write` if the lockfile lives outside the worktree. Mitigation: the orchestrator pre-installs dependencies before handing control to Codex.
- User confirmation adds friction for power users. Accepted: security over convenience.

## Alternatives considered

- **Always `danger-full-access`**: rejected — violates principle of least privilege. A prompt injection in the task description could cause filesystem damage.
- **Three-tier model** (read-only / workspace-write / full): deferred — read-only mode has limited utility for code generation tasks.

## References

- Decision D7 in `CLAUDE.md`
- `packages/execution-core/src/types.ts`: `SandboxModeSchema`, `ExecutionConfigSchema`
- Codex CLI documentation: sandbox modes
