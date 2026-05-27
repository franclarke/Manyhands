# Conflict Benchmark v0

Lab Mode note: `conflict-v0` is a controlled stress benchmark for conflict-aware scheduling and gate behavior. It is intentionally separate from future real worktree and real agent execution.

`conflict-v0` lives at:

```txt
benchmarks/conflict-v0/benchmark.json
```

It runs B0-B4 over five controlled conflict features and uses the existing `aprobado-lite` repository fixture.

## Command

```bash
pnpm demo:benchmark:conflicts
pnpm demo:benchmark:conflicts -- --export .manyhands/benchmarks/conflict-v0/reports/conflict-v0.benchmark-report.json
pnpm demo:benchmark:conflicts -- --save-runs
pnpm demo:benchmark:conflicts -- --config B4
```

The command does not execute agents, tests, worktrees, SQLite, merges or real code changes.

## Interpretation

`blocking` is a ManyHands orchestration signal. It means the mock risk model recommends review or serialization. It does not prove that git merge would fail.
