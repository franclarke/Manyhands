# 0019 · Codex CLI in non-interactive mode

## Status

Accepted. Types defined in `CodexCliExecutorOptionsSchema` (`packages/execution-core`).

## Context

ManyHands orchestrates Codex CLI as a sub-agent executor. Codex CLI can run interactively (prompting the user for tool approvals) or non-interactively (auto-approving all tool use). For automated orchestration, the agent must never block waiting for human input.

## Decision

- Codex CLI is invoked via `codex exec` with flags that ensure non-interactive execution:
  - Task instructions are written to a temp file and passed via `--instructions-file` (not stdin).
  - `bypassApprovals: true` configures auto-approval of all tool calls within the sandbox boundary.
  - The process runs with a hard timeout (`timeoutMs`) enforced by the orchestrator.
- Codex CLI is the **only** agent executor (Decision D4). No direct `child_process.exec`, no Claude Code SDK, no alternative CLIs.
- The orchestrator captures `exitCode`, `stdout`, and `stderr` but trusts only `git diff HEAD` for determining results (see ADR-0020).

## Consequences

Positive:
- Fully automated — no human-in-the-loop during leaf execution.
- Deterministic timeout behavior — the orchestrator kills the process if it exceeds `timeoutMs`.
- Instruction files provide a clean audit trail.

Negative / accepted:
- `bypassApprovals: true` means the agent can use any tool within its sandbox. Mitigated by sandbox mode restrictions (ADR-0018).
- Codex CLI must be installed and available on `$PATH`. If missing, the executor fails with a clear error.

## Alternatives considered

- **Claude Code SDK direct integration**: rejected — Codex CLI provides sandboxing, tool use, and model selection out of the box.
- **Interactive mode with auto-responder**: rejected — fragile and adds unnecessary complexity.

## References

- Decision D4 in `CLAUDE.md`
- `packages/execution-core/src/types.ts`: `CodexCliExecutorOptionsSchema`
