# ADR 0004 - Deterministic Mock Decomposer

> Superseded note (June 2026): deterministic Lab-style planning is no longer an
> active product or evaluation path. This ADR is historical context only.

## Status

Accepted.

## Context

ManyHands eventually needs an LLM-backed recursive decomposer. That component will be variable, prompt-sensitive and expensive to evaluate. The project first needs a reproducible vertical slice that proves the graph, contracts, risk predictor, scheduler and traces compose correctly.

## Decision

Implement `@manyhands/decomposer` with an async `Decomposer` interface and a deterministic `MockDecomposer`.

The mock decomposer:

- consumes a validated `FeatureRequest`;
- emits a valid `TaskGraph`;
- embeds one `AgentTaskContract` per leaf;
- supports `coarse`, `balanced` and `fine` modes;
- uses the passwordless-login fixture as the first laboratory scenario;
- performs no network calls, agent calls, prompts, repo inspection or filesystem writes.

The first orchestrated flow lives in `@manyhands/core`, not in a separate `orchestrator` package, because it only composes existing domain packages for a demo slice.

## Consequences

- The planning flow is deterministic and easy to test.
- The decomposition mode is now represented in code and can later become an experimental variable.
- A future LLM decomposer can implement the same interface.
- The mock cannot prove decomposition quality; it only proves pipeline correctness.
