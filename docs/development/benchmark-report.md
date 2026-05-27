# Benchmark Report

Lab Mode note: `BenchmarkReport` is an evaluation artifact for mock and controlled runs. It supports the product and thesis narrative, but it is not evidence of real agent quality by itself.

Phase 7 adds `BenchmarkReport` in `@manyhands/evaluator`.

Current schema version:

```txt
manyhands.benchmark-report.v2
```

The report contains:

- benchmark id and version;
- selected feature ids;
- selected configuration ids;
- evaluated run metrics;
- aggregate metrics by configuration;
- methodological warnings;
- deterministic report hash.

## Aggregate Metrics

The report aggregates:

- average leaf count;
- average dependency count;
- average static signal count;
- average high/blocking risk count;
- average batch count;
- average simulated duration;
- average estimated wall-clock duration;
- average trace event count;
- total scope violations;
- average coordination overhead units.
- average gate-required decisions;
- average tasks serialized by gate;
- average tasks blocked by gate;
- average mock reviews.

## Methodological Warnings

Warnings such as `benchmark_mock_only`, `mock_execution_only`, `no_real_agent_results`, `no_real_tests_executed`, `single_task_baseline_is_structural`, `human_gate_is_mock`, `controlled_conflict_fixture`, `blocking_risk_does_not_equal_real_merge_conflict` and `scope_violation_is_simulated` are intentional. They prevent mock structural comparisons from being interpreted as final empirical evidence.
