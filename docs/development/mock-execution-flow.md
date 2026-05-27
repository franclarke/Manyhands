# Mock Execution Flow

## Goal

Phase 3 extends the deterministic planning slice into simulated execution:

```txt
FeatureRequest
  -> MockDecomposer
  -> Scheduler
  -> MockWorktreeRunner
  -> Scope validation
  -> Simulated AgentRunResult
  -> Execution traces
  -> Execution summary
```

## Command

```bash
pnpm demo:execute:mock
```

The command builds the workspace, loads `examples/features/passwordless-login.json`, runs the balanced mock plan, executes scheduled batches with the mock runner and prints a summary.

## Export

Export is explicit and writes a versioned `RunSnapshot`:

```bash
pnpm demo:execute:mock -- --export examples/runs/passwordless-login-balanced.mock-run.json
```

No files are written unless `--export` is passed.

The run can also be saved to the local JSON store:

```bash
pnpm demo:execute:mock -- --save
```

## Trace Events

The flow records:

- `execution_started`;
- `batch_execution_started`;
- `task_execution_started`;
- `mock_worktree_created`;
- `agent_run_started`;
- `agent_run_completed`;
- `agent_run_failed`;
- `scope_validated`;
- `batch_execution_completed`;
- `execution_completed`;
- `execution_failed` on unrecoverable flow errors.

## Execution Semantics

Batches preserve scheduler structure. Tasks inside a batch are simulated sequentially for determinism; this is not real concurrency.

Scope violations make a task result fail because the contract is binding.

## Limitations

This flow does not create real worktrees, run commands, execute agents, apply patches, merge branches, persist SQLite data or prove code quality.
