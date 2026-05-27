# Architecture

ManyHands is being shaped as a visual orchestration workspace for multi-agent software development. The current implementation is the deterministic core and Lab Mode foundation; the next architecture layer is a web app and API that consume this core directly.

## Product Architecture

Target product architecture:

```txt
Web/Desktop UI
  -> API layer
  -> Core orchestration
  -> Runner adapters
  -> Repository/worktree layer
  -> Trace/evaluation layer
```

The web app should not reimplement orchestration logic. It should call API routes backed by existing package APIs and display validated core artifacts: `TaskGraph`, `AgentTaskContract`, risk matrices, schedules, `RunSnapshot` and `BenchmarkReport`.

Desktop remains a future packaging mode, not a separate architecture today. A future desktop app would mainly add local filesystem, git and subprocess permissions around the same core abstractions.

## Lab Architecture

Current Lab Mode architecture:

```txt
BenchmarkManifest
  -> mock flows
  -> RunSnapshot
  -> Evaluator
  -> BenchmarkReport
```

Lab Mode exists to compare orchestration configurations under deterministic conditions:

- B0 `single_task_mock`;
- B1 `decomposed_sequential`;
- B2 `decomposed_parallel_naive`;
- B3 `decomposed_risk_aware`;
- B4 `human_gated_mock`.

It is intentionally structural and mock-only. It validates graph shape, scheduling behavior, risk evidence, traceability and reporting before real agents are introduced.

## Current Core Flow

```txt
TaskGraph
  -> AgentTaskContract
  -> RepositoryIndex
  -> StaticConflictSignals
  -> ConflictRisk
  -> Scheduler
  -> MockWorktreeRunner
  -> ScopeValidation
  -> RunSnapshot
  -> Evaluator
  -> BenchmarkReport
```

## Package Boundaries

- `shared`: small schemas and deterministic helpers.
- `contracts`: task contracts, context packs, validation commands, acceptance criteria and agent run results.
- `task-graph`: task nodes, dependencies, graph validation, DAG cycle detection, orphan detection, readiness and state aggregation.
- `conflict-risk`: pairwise risk predictions using contract metadata and optional static evidence.
- `repository-index`: deterministic TypeScript repository index for files, symbols, imports and exports.
- `scheduler`: batch generation for sequential, naive parallel and risk-aware execution.
- `scope-validation`: pure contract scope enforcement for mock and future real runners.
- `trace-store`: trace event interface and in-memory store.
- `run-store`: versioned run snapshot schema, JSON persistence and deterministic hashes.
- `worktree-runner`: adapter boundary for future real agents; currently includes a deterministic mock runner.
- `evaluator`: structural/mock metrics, methodological warnings, granularity comparison reports and benchmark aggregate reports over run snapshots.
- `core`: convenience exports and deterministic orchestration flows for planning, execution, granularity comparison and mock benchmark comparison.
- `apps/web`: Next.js web app foundation with product shell, Lab Mode pages and API routes over the existing core.

The web app also contains UI-facing view models under `apps/web/src/lib`. These mappers translate core artifacts into component props without changing core schemas. The first example is `graph-view-model.ts`, which maps a `RunSnapshot` to graph nodes, dependency/risk/gate edges and summary counts for the future read-only DAG canvas.

## Dependency Direction

The dependency direction remains:

```txt
apps -> core -> domain packages -> shared
```

Domain packages must not import from `apps`. The web/API layer should depend on stable package boundaries and should avoid UI-specific schema forks unless a view model is clearly separated from core schemas.

For the current implementation, `contracts` is independent from `task-graph` because an `AgentTaskContract` only needs a `taskId`. `task-graph` imports the contract schema to validate leaf nodes with embedded contracts. This avoids a package cycle and keeps the contract model reusable by future runners.

## Runtime Design

Everything implemented so far is pure, in-memory or explicit JSON artifact persistence. `InMemoryTraceStore` stores events in process memory for tests and orchestration. `JsonRunStore` persists complete run snapshots only when a command explicitly exports or saves a run.

The current runtime does not perform filesystem worktree operations, create git branches, run subprocesses, call LLMs, use network APIs or write database records.

The future runtime should introduce effects in this order:

1. API routes over existing deterministic flows.
2. Live mock execution state for the web app.
3. Real git worktree lifecycle with a deterministic command runner.
4. Real validation commands and diff capture.
5. Agent adapters behind explicit feature flags.
6. Bottom-up integration.

## Run Persistence

Phase 4 stores complete `RunSnapshot` artifacts instead of only event streams. A snapshot includes the feature request, graph, contracts, risk matrix, schedule, simulated run results, scope validations, traces, summary, schema version and deterministic hashes.

SQLite remains deferred. The JSON store establishes the durable artifact contract first and can be replaced by a future SQLite adapter when the product needs queryable run history, dashboards across many runs or richer evaluation workflows.

## Evaluation

Evaluator v0 consumes `RunSnapshot` artifacts and derives structural/mock metrics for graph shape, contracts, conflict risk, scheduling, simulated execution, traceability and coordination overhead.

The granularity comparison harness runs `coarse`, `balanced` and `fine` decompositions over the passwordless-login fixture and emits a versioned `EvaluationReport`.

The mock benchmark harness runs five controlled features and configurations B0-B3. The conflict benchmark adds controlled conflict scenarios and B4 `human_gated_mock`, which records deterministic gate decisions over high and blocking risk signals. Benchmark runs emit versioned `BenchmarkReport` artifacts with aggregate metrics by configuration.

Evaluator and benchmark reports do not execute agents, run target repository tests, merge code or claim real code quality results.

## Conflict Risk Model

The current predictor is deterministic. Without a repository index it uses declared contract metadata:

- exact expected file overlap;
- allowed or expected path overlap;
- shared relevant symbols;
- producer-consumer artifact relationships;
- critical paths such as config, schema, migrations and shared types;
- shared test fixtures.

Levels are `low`, `medium`, `high` and `blocking`. The scheduler serializes high-risk pairs and treats blocking pairs as requiring review or serialization.

When a `RepositoryIndex` is provided, ManyHands derives static conflict signals from TypeScript AST structure and adds them as auditable evidence. The indexer is structural v0 only; it does not run a typechecker or perform semantic analysis.

## Scheduling

The scheduler produces full execution batches over pending leaf tasks, simulating completion batch by batch. It respects declared graph dependencies and `maxParallel`.

- `sequential_dag`: one ready task per batch.
- `parallel_naive`: all ready tasks up to `maxParallel`, ignoring risk.
- `risk_aware`: greedy batching that avoids high or blocking risk pairs.

B4 does not add a scheduler policy. It applies a deterministic human-gate wrapper over `risk_aware`, recording simulated gate decisions and serializing blocking work after mock review.

## Current Implementation Status

Already implemented:

- deterministic core models;
- mock decomposition;
- task contracts;
- repository index v0;
- static conflict signals;
- risk-aware scheduling;
- deterministic mock execution;
- scope validation;
- run snapshots;
- evaluator and benchmark reports;
- mock-v0 and conflict-v0 benchmarks;
- B0-B4 including B4 human-gated mock.

Currently simulated:

- worktree sessions;
- branches;
- diffs;
- validation results;
- execution duration and cost;
- human-gate decisions;
- benchmark outcomes.

Missing for product:

- DAG canvas;
- run snapshot viewer;
- persisted report browser;
- live mock execution UX;
- conflict and gate visualization;
- polished desktop-like interaction model.

Partially implemented for product:

- web app shell;
- API-backed benchmark listing;
- API-backed benchmark execution;
- benchmark report summary UI.
- demo `RunSnapshot` endpoint for `conflict-v0` / B4;
- placeholder `/replay/demo` route and graph view-model handoff.

Missing for real execution:

- real git worktrees;
- real branches;
- real subprocess or command runner;
- real validation command execution;
- real diff capture;
- bottom-up integration engine;
- real merge/conflict handling.

Missing for real agents:

- adapter hardening;
- contract-to-prompt mapping;
- Claude Code/Codex/Aider adapter;
- credential and cost guardrails;
- controlled pilot runs;
- empirical evaluation over real outputs.

## Out Of Scope For The Current Core

- production UI;
- recursive LLM decomposer;
- real agent execution;
- real worktrees;
- bottom-up integration;
- SQLite trace persistence;
- real human review;
- TypeScript semantic analysis with a full typechecker;
- empirical quality claims.
