# Mock Planning Flow

## Goal

The mock planning flow is the first deterministic vertical slice:

```txt
FeatureRequest
  -> MockDecomposer
  -> TaskGraph + AgentTaskContracts
  -> Graph validation
  -> Contract validation
  -> Conflict risk matrix
  -> Scheduler
  -> Trace events
  -> Planning summary
```

It does not execute agents, create worktrees, open a UI or write persistent outputs.

## Command

```bash
pnpm demo:plan
```

The command builds the workspace, loads `examples/features/passwordless-login.json`, runs the mock decomposer in `balanced` mode, schedules with `risk_aware` and prints a console summary.

## Trace Events

The flow records the following in `InMemoryTraceStore`:

- `feature_loaded`;
- `decomposition_started`;
- `graph_created`;
- `contract_created`;
- `graph_validated`;
- `contract_validated`;
- `risk_predicted`;
- `batch_scheduled`;
- `planning_run_completed`;
- `planning_run_failed` on failure.

## Summary

The returned summary includes:

- run id;
- feature id;
- decomposition mode;
- task and leaf counts;
- dependency count;
- contract count;
- risk prediction count;
- scheduled batches;
- trace event count;
- validation issues.

## Next Step

The next phase can add a worktree runner mock that consumes scheduled leaf contracts and returns deterministic run results. That should still avoid real agents until scope validation and trace persistence are stronger.
