# 0020 · Git diff as the source of truth for agent results

## Status

Accepted. Types defined in `AgentExecutionResultSchema` (`packages/execution-core`).

## Context

After Codex CLI completes a task, the orchestrator needs to determine what the agent actually changed. There are multiple possible sources: Codex stdout/stderr, the instruction file response, or the git working tree state. These sources can disagree — the agent might claim success but produce no changes, or produce changes outside the expected scope.

## Decision

- **`git diff HEAD`** is the canonical source of truth for what an agent changed.
- `changedFiles` is derived by parsing the diff output (file paths from `--name-only`).
- `diff` stores the full unified diff for audit and integration.
- Agent stdout/stderr are captured for debugging but never used to determine success or changed files.
- An empty diff with a successful Codex exit code produces `status: "empty_diff"` — not `"success"`.

## Consequences

Positive:
- Objective, verifiable — git doesn't lie about what changed on disk.
- Independent of Codex CLI output format changes — the orchestrator is decoupled from Codex internals.
- Diff output feeds directly into the integration pipeline (cherry-pick, scope checking).

Negative / accepted:
- Agent-generated files that are `.gitignore`-d won't appear in the diff. Accepted: if it's not tracked, it's not part of the deliverable.
- Binary files show as changed but without readable diff content. Accepted: rare for code generation tasks.

## Alternatives considered

- **Parse Codex stdout for a structured result**: rejected — stdout format is not a stable API, and the agent could hallucinate its output summary.
- **Use both diff and stdout, reconcile**: rejected — adds complexity for marginal benefit. One source of truth is simpler.

## References

- Decision D5 in `CLAUDE.md`
- `packages/execution-core/src/types.ts`: `AgentExecutionResultSchema` (fields `diff`, `changedFiles`, `baseHead`, `currentHead`)
