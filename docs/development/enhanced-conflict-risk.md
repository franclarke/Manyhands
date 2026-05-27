# Enhanced Conflict Risk

## Goal

Phase 5 extends the metadata-only risk predictor with optional static signals.

Baseline behavior remains:

```ts
buildTaskPairRiskMatrix({ contracts })
```

Enhanced behavior is opt-in:

```ts
buildTaskPairRiskMatrix({ contracts, staticSignals })
```

## Compatibility

Without `staticSignals`, the predictor behaves as before. Existing scheduling and execution flows continue to work.

With `staticSignals`, pairwise signals add auditable `ConflictEvidence` entries prefixed with `static_`. Severity contributes conservative weights:

- low: small warning signal;
- medium: scheduling caution;
- high: serialize if paired in the same batch;
- blocking: human review.

## Flow Integration

`runMockExecutionFlow` can receive a `repositoryIndex`. In that mode, planning generates static signals, builds an enhanced risk matrix and stores repository index metadata in the `RunSnapshot`.

## Limits

This does not execute agents, create worktrees, run a typechecker, merge branches or provide empirical proof of quality. It only improves the pre-execution conflict evidence available to the scheduler.
