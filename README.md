# ManyHands

ManyHands is a visual orchestration workspace for multi-agent software development. The intended product is a web app, and later possibly a desktop app, where a developer describes a feature, module, application or software change and ManyHands turns that goal into an auditable execution graph.

The target experience is:

```txt
developer goal / feature / app
  -> recursive decomposition
  -> DAG visual
  -> atomic leaf tasks
  -> parallel subagents
  -> conflict-aware scheduling
  -> human gate when needed
  -> bottom-up integration
  -> completed parent objective
  -> reproducible traces/evaluation
```

The benchmark runner is still important, but it is Lab Mode: a controlled way to validate orchestration strategies before real agents, real worktrees and real integrations are introduced. It is not the full identity of the product.

## Product Direction

ManyHands should let a developer:

- describe a feature, app slice or software change in natural language;
- review a recursive decomposition into a hierarchical DAG;
- inspect dependencies, blocked tasks, conflict risk and human-gate decisions visually;
- execute ready leaf tasks through isolated runners or future subagents;
- integrate completed leaves bottom-up into their parent objective;
- replay runs through snapshots, traces and reports;
- compare orchestration configurations in a reproducible lab workflow.

The current repository is the deterministic foundation for that product. The next strategic priority is to put a real web UI and API layer on top of the existing core instead of treating the CLI benchmark as the end product.

## Current Status

Implemented through Phase 8:

- deterministic TypeScript monorepo with `pnpm`, strict `tsconfig`, Vitest, ESLint and tsup;
- `TaskGraph` validation, DAG readiness and status aggregation;
- `AgentTaskContract` schemas and scope metadata;
- deterministic metadata-based `ConflictRisk`;
- `RepositoryIndex` and static conflict signals v0 over a small TypeScript fixture;
- `Scheduler` policies: `sequential_dag`, `parallel_naive` and `risk_aware`;
- deterministic `MockWorktreeRunner`;
- reusable `ScopeValidation`;
- versioned `RunSnapshot` artifacts and JSON export/import;
- `Evaluator` v0 and granularity comparison;
- `BenchmarkReport` schemas and aggregate metrics;
- benchmark `mock-v0` with B0-B3;
- benchmark `conflict-v0` with B0-B4, including B4 `human_gated_mock`.
- Phase 10 web app foundation under `apps/web`;
- first API-backed Lab Mode routes for listing and running deterministic benchmarks.
- a small demo RunSnapshot endpoint and graph view-model handoff for the future read-only DAG canvas.

Not implemented yet:

- no DAG canvas UI yet;
- no live mock execution UX yet;
- no real LLM, Claude Code, Codex, Aider or subprocess agent adapter;
- no real git worktree lifecycle;
- no real branch integration or bottom-up merge engine;
- no SQLite persistence yet;
- no empirical benchmark with real agent outputs or real target-repository tests.

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

## Repository Layout

```txt
apps/
  web/                 # Next.js web app foundation, Lab Mode API routes and snapshot handoff
packages/
  core/                # Re-exports and deterministic orchestration flows
  task-graph/          # Task DAG, validation, readiness, aggregation
  contracts/           # AgentTaskContract and related schemas
  conflict-risk/       # Pairwise risk prediction from declared metadata
  repository-index/    # TypeScript repository indexing v0
  scheduler/           # Execution batch policies
  worktree-runner/     # AgentRunner interface and mock runner
  scope-validation/    # Reusable contract scope validation
  run-store/           # RunSnapshot schema and JSON persistence
  trace-store/         # TraceStore interface and in-memory implementation
  decomposer/          # Deterministic mock decomposers
  evaluator/           # Evaluator v0 metrics and benchmark reports
  shared/              # Shared schemas and pure helpers
docs/
  adr/
  development/
  research/
examples/
benchmarks/
tests/
```

## Commands

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm web:dev
pnpm web:typecheck
pnpm web:lint
pnpm web:build

# Web API examples
curl http://localhost:3000/api/health
curl http://localhost:3000/api/benchmarks
curl "http://localhost:3000/api/demo/run-snapshot?benchmark=conflict-v0&config=B4"

pnpm demo:plan
pnpm demo:execute:mock
pnpm demo:index:repo
pnpm demo:execute:mock -- --with-static-signals --repository examples/repos/aprobado-lite

pnpm demo:compare:granularity
pnpm demo:compare:granularity -- --export .manyhands/comparisons/passwordless-login-granularity.mock-eval.json
pnpm demo:compare:granularity -- --save-runs

pnpm demo:benchmark:mock
pnpm demo:benchmark:mock -- --export .manyhands/benchmarks/mock-v0/reports/mock-v0.benchmark-report.json
pnpm demo:benchmark:mock -- --save-runs
pnpm demo:benchmark:mock -- --feature passwordless-login --config B3

pnpm demo:benchmark:conflicts
pnpm demo:benchmark:conflicts -- --export .manyhands/benchmarks/conflict-v0/reports/conflict-v0.benchmark-report.json
pnpm demo:benchmark:conflicts -- --config B4

pnpm demo:execute:mock -- --mode balanced --export examples/runs/passwordless-login-balanced.mock-run.json
pnpm demo:execute:mock -- --mode balanced --save
pnpm runs:list
pnpm runs:show -- passwordless-login:balanced:mock-execution-run
pnpm runs:import -- examples/runs/passwordless-login-balanced.mock-run.json
pnpm runs:export -- passwordless-login:balanced:mock-execution-run --out tmp/passwordless-login-balanced.json
```

## Near-Term Roadmap

The next phases are productization phases over the existing deterministic core:

- DAG Canvas read-only from `RunSnapshot` artifacts;
- replace the `/replay/demo` table with a proper DAG canvas using the graph view-model;
- task inspector and trace viewer;
- benchmark and report viewer;
- live mock execution UX;
- controlled conflict and gate visualization;
- import/adapt the Claude Design DAG canvas into real React components;
- real worktree runner v0 without LLM;
- validation command runner and diff capture;
- agent adapter behind a feature flag;
- bottom-up integration engine v0.

See:

- `docs/development/roadmap.md`
- `docs/development/product-vision.md`
- `docs/development/ui-vision.md`
- `docs/development/web-app-roadmap.md`
- `docs/development/thesis-plan.md`

## Methodological Note

Current benchmark results are structural, deterministic and mock-only. They are useful for validating architecture, traceability, scheduling behavior and controlled conflict handling, but they are not final empirical evidence about real agent quality, real merge quality, productivity or thesis outcomes.

B0 is a structural single-task baseline, not a real single-agent run. B4 is a deterministic mock human gate, not real human review. `blocking` risk is an orchestration signal, not proof of a real git merge conflict.
