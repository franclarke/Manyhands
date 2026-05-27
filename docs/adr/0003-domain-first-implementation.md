# ADR 0003 - Domain First Implementation

## Status

Accepted.

## Context

ManyHands has several future infrastructure concerns: git worktrees, agent CLIs, SQLite, API servers, WebSockets, UI dashboards and benchmark runners. Implementing those before the domain contracts are stable would make the project harder to test and defend.

## Decision

Implement the core as pure TypeScript packages first:

- graph validation before decomposer automation;
- contracts before prompt generation;
- metadata risk prediction before static analysis;
- scheduling before real execution;
- in-memory traces before SQLite.

The first runner is a stub implementing the future `AgentRunner` interface. It does not call git or any external agent.

## Consequences

- Every current component is unit-testable.
- Future infrastructure can be added behind stable interfaces.
- The initial conflict predictor is intentionally heuristic and must not be presented as empirical evidence until benchmark data exists.
