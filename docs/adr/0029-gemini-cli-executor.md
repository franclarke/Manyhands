# 0029 · Gemini CLI as agent executor

## Status

Superseded by ADR-0031 (Claude Code + Codex executors). Históricamente Accepted;
supersedió a ADR-0019 (Codex CLI in non-interactive mode). Gemini CLI fue removido
en 2026-06-16 tras la deprecación del tier gratuito (2026-06-18).

## Context

ManyHands originally used Codex CLI (`codex exec --instructions-file`) as the agent executor for leaf tasks and a single-pass Anthropic decomposer for planning. In June 2026, Gemini CLI became the practical choice for both roles. The executor seam (`AgentExecutor` interface) was already provider-agnostic by design, making the migration possible without restructuring the orchestration pipeline.

## Decision

- Gemini CLI (`gemini`) is the only agent executor and the step-model for the recursive decomposer. Replaces Codex CLI.
- **Leaf task execution:** `gemini -p <prompt>` with the full task prompt sent via stdin. Flag `--approval-mode yolo` auto-approves all tool calls to prevent interactive blocking in headless mode.
- **Decomposer steps:** `--approval-mode plan` (read-only mode; Gemini can read files to ground interface decisions, but cannot write or execute commands).
- **Binary path:** configurable via `MANYHANDS_GEMINI_BIN` env var (default: `gemini`). On Windows, may need a `.cmd` shim.
- The `AgentExecutor` interface stays provider-agnostic. A future swap requires only a new adapter.

## Consequences

Positive:
- Fully automated — `--approval-mode yolo` prevents interactive prompts from blocking headless leaf execution.
- `--approval-mode plan` gives the decomposer safe read access for repo grounding without side effects.
- The provider-agnostic seam keeps the pipeline decoupled from the specific CLI.

Negative / accepted:
- `--approval-mode yolo` means Gemini can use any tool within the worktree during execution. Real isolation comes from the git worktree boundary + `ScopeChecker`, not from the CLI mode.
- Gemini CLI must be installed and on `$PATH` (or `MANYHANDS_GEMINI_BIN`). Missing binary → clear executor error.
- On Windows, process termination uses `taskkill /T /F` to kill the process tree (implemented in `GeminiCliExecutor`).

## Migration from Codex CLI

| Codex CLI | Gemini CLI |
|-----------|------------|
| `codex exec --instructions-file <path>` | `gemini -p <prompt>` (prompt via stdin) |
| `bypassApprovals: true` | `--approval-mode yolo` |
| `--sandbox workspace-write` | isolation via worktree + ScopeChecker |
| `CodexCliExecutorOptions` schema | `AgentExecutorOptionsSchema` (provider-agnostic) |
| `CodexExecutionError` | `AgentExecutionError` |
| `codex_started` / `codex_completed` trace events | `executor_started` / `executor_completed` |
| `AnthropicDecomposer` (default) | `GeminiRecursiveDecomposer` (default) |

## Alternatives considered

- **Remaining on Codex CLI:** rejected — access became impractical.
- **Claude Code SDK direct integration:** rejected — Gemini CLI provides non-interactive execution without additional SDK integration overhead.
- **Direct subprocess without CLI wrapper:** rejected — the CLI handles tool use routing; reimplementing that is out of scope.

## References

- Decision D4 in `CLAUDE.md`
- `packages/execution-core/src/executor/gemini-cli.ts` — `GeminiCliExecutor`
- `packages/decomposer/src/llm/recursive/gemini-recursive-decomposer.ts` — `GeminiRecursiveDecomposer`
- Supersedes: ADR-0019
