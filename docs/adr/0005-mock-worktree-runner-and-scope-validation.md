# ADR 0005 - Mock Worktree Runner And Scope Validation

> Superseded note (June 2026): mock worktree execution and the old
> `scope-validation`/`worktree-runner` packages were removed. This ADR is
> historical context only.

## Status

Accepted.

## Context

ManyHands needs to simulate execution before introducing real worktrees or coding agents. The system already produces a deterministic plan, contracts, risk matrix, schedule and traces. The next step is to prove that scheduled leaf contracts can flow through a runner boundary and produce auditable run results.

## Decision

Implement:

- `@manyhands/scope-validation` as a reusable pure package;
- `MockWorktreeRunner` inside `@manyhands/worktree-runner`;
- `runMockExecutionFlow` inside `@manyhands/core`;
- `pnpm demo:execute:mock` as the deterministic execution demo.

The mock runner derives diffs and changed files from `AgentTaskContract.expectedOutput`. It never calls git, creates worktrees, runs subprocesses or invokes agents.

Scope validation checks declared metadata only. It validates allowed paths, forbidden paths, expected files, expected symbols, required validation commands and undeclared critical paths.

## Consequences

- Execution orchestration can be tested end-to-end without external dependencies.
- Future real runners can reuse the same `AgentRunner` interface and scope validator.
- Results remain mock data and must not be used as empirical evidence of implementation quality.
- The glob matcher is deliberately small and may be replaced later if real repo patterns require it.
