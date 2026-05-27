# ADR 0009 - Evaluator V0 Granularity Comparison

## Status

Accepted.

## Context

ManyHands can now produce deterministic run snapshots with graph, contracts, risk predictions, static conflict signals, schedule, mock execution results, scope validation and traces.

The thesis needs a path from reproducible artifacts toward experimental comparison. The central research question involves decomposition granularity, but the project still does not execute real agents or real integrations.

## Decision

Introduce `@manyhands/evaluator` as a pure package that consumes `RunSnapshot` artifacts and calculates structural/mock metrics.

Add a core granularity comparison flow that runs:

```txt
coarse
balanced
fine
```

against the existing passwordless-login fixture and repository index fixture.

The evaluator emits `EvaluationReport` artifacts with schema version:

```txt
manyhands.evaluation-report.v1
```

Methodological warnings are required output, not incidental logging.

## Consequences

- ManyHands can compare decomposition modes reproducibly.
- The comparison is useful for dashboard and benchmark preparation.
- The evaluator remains decoupled from runner internals and filesystem persistence.
- Mock structural metrics must not be presented as final empirical evidence.
- SQLite, UI, real agents, real worktrees, integration and deep typechecking remain deferred.
