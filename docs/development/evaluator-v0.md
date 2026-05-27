# Evaluator V0

Lab Mode note: evaluator v0 turns deterministic snapshots into structural metrics. It is useful for thesis scaffolding and future dashboards, but it is not a real-agent quality evaluator.

## Purpose

Phase 6 introduces the first ManyHands evaluator. It consumes versioned `RunSnapshot` artifacts and computes reproducible structural metrics.

This evaluator is intentionally limited to deterministic mock runs. It does not evaluate real agent quality, merge quality, production readiness or final thesis evidence.

## Package

The implementation lives in `@manyhands/evaluator`.

It exports:

- `evaluateRunSnapshot`;
- `evaluateRunSnapshots`;
- `compareRunSnapshots`;
- `compareGranularitySnapshots`;
- `EvaluationReportSchema`;
- `RunMetricsSchema`;
- deterministic report hash helpers.

## Metric Groups

For each run, evaluator v0 calculates:

- graph metrics: task count, leaf count, composite count, dependencies, max depth;
- contract metrics: contract count and average scope, acceptance and validation surface;
- conflict metrics: risk counts plus static signal counts;
- scheduling metrics: batches, batch sizes and blocked tasks;
- execution metrics: simulated success/failure, scope violations, diffs, duration and cost;
- traceability metrics: trace event counts and hash presence;
- coordination metrics: a simple structural overhead unit.

## Methodological Warnings

Warnings are part of the output contract. They prevent mock structural results from being confused with real empirical evidence.

Expected warnings include:

- `mock_execution_only`;
- `no_real_agent_results`;
- `no_real_tests_executed`;
- `small_fixture_only`;
- `static_signals_are_heuristic`;
- `missing_static_signals`;
- `missing_hashes`;
- `incompatible_feature_ids`.

## Limits

Evaluator v0 does not compute pass rate, precision/recall, F1, statistical confidence, quality scoring or LLM-as-judge metrics. Those require real agent runs, real integration outcomes and benchmark datasets.
