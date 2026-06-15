# ADR-0030: Multi-Agent Executor Registry

## Status

Accepted

## Context

ManyHands originally constrained execution and recursive planning to Gemini CLI
as the only concrete agent executor. That made the system simpler and protected
the D5-D8 execution invariants, but it also made provider health opaque and made
per-node cost/quality tradeoffs impossible.

The next product step needs multiple agentic CLI executors while preserving the
research-critical execution model:

- every executor runs headless in an isolated git worktree;
- no executor may commit;
- `git diff HEAD` remains the only source of truth for changes;
- the orchestrator still owns scope checking, validation, commits, and
  cherry-pick integration;
- API-only LLM providers are not equivalent to coding agents with tools over a
  worktree.

## Decision

Replace the strict "Gemini CLI is the only executor" interpretation of D4 with
an executor registry:

- Gemini CLI remains the default executor and the default recursive decomposer
  step model.
- A valid execution provider must implement `AgentExecutor`.
- A valid execution provider must run headless, operate inside the orchestrator
  worktree, respect timeout, avoid commits, and let the orchestrator derive
  changes from `git diff HEAD`.
- `RunExecutor` resolves an `ExecutorSelection` for each leaf and composite
  repair, then obtains the concrete adapter from `AgentExecutorFactory`.
- `run.model` remains as a legacy Gemini default for persisted runs.
- API providers such as OpenRouter may support usage/cost accounting or future
  planning flows, but they are not node executors unless they are wrapped by a
  worktree-capable agent adapter.

## Consequences

- Gemini CLI remains backwards-compatible for all existing runs.
- Claude Code CLI can be added as the first alternate agentic executor because
  its print mode supports non-interactive operation.
- Codex CLI and OpenCode can be registered but disabled until their
  non-interactive Windows behavior and worktree safety are verified.
- Execution traces must include `executorId`, `model`, and `usageSource` so UI
  and persisted evidence explain how each node ran.
- Usage UI must never invent cost. Unknown token/cost data is shown as
  unavailable.

## References

- Claude Code CLI reference: https://docs.anthropic.com/en/docs/claude-code/cli-usage
- Codex CLI overview: https://help.openai.com/en/articles/11096431
- OpenRouter usage accounting: https://openrouter.ai/docs/use-cases/usage-accounting
