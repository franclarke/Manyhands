# ADR 0010: Benchmark Dataset v0

> Superseded note (June 2026): `benchmarks/mock-v0`, benchmark manifests and
> report schemas are no longer active. This ADR is historical context only.

## Status

Accepted.

## Context

ManyHands already supports deterministic decomposition, planning, simulated execution, run snapshots, static conflict signals and evaluator v0. Phase 6 compared granularities over one feature fixture, which was useful as a smoke test but too narrow for an experimental thesis workflow.

The thesis needs a reproducible harness that compares orchestration configurations over multiple controlled features before introducing real agents.

## Decision

Implement `benchmarks/mock-v0` with five small feature fixtures and four configurations:

- B0 `single_task_mock`
- B1 `decomposed_sequential`
- B2 `decomposed_parallel_naive`
- B3 `decomposed_risk_aware`

Add `SingleTaskDecomposer` for B0 and `MetadataDrivenMockDecomposer` for multi-feature deterministic decomposition. Add `BenchmarkManifest` and `BenchmarkReport` schemas in `@manyhands/evaluator`, and orchestrate the benchmark from `@manyhands/core`.

Do not add SQLite, UI, real agents, real worktrees, integration, deep typechecking or real benchmark execution in this phase.

## Consequences

ManyHands can now compare orchestration configurations across multiple deterministic features and export a validated benchmark report.

B0 is explicitly a structural mock baseline and must not be described as a real single-agent run. All benchmark reports include methodological warnings indicating that results are mock-only and not evidence of final code quality.

## Alternatives Considered

SQLite was deferred because reproducible JSON artifacts already cover the current persistence need.

A real runner was deferred because it would break determinism and introduce cost, tool and repository variability too early.

A deep typechecker was deferred because static conflict signals v0 are sufficient for this benchmark harness.

A UI slice was deferred because the experiment shape needed to stabilize first.
