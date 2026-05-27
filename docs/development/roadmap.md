# Roadmap

This roadmap realigns ManyHands from a mock benchmark laboratory into a product-oriented visual orchestration app. The benchmark remains a first-class Lab Mode for reproducible evaluation, but the product identity is now the web workspace that helps a developer decompose, inspect, execute, gate and integrate software work.

## Roadmap Summary

```txt
Completed foundation
  Phase 0-8: deterministic core, mock execution, conflict benchmark, B0-B4

Productization
  Phase 9: product vision alignment and web app prep
  Phase 10: web app foundation
  Phase 11: API layer over existing core
  Phase 12: benchmark/report viewer
  Phase 13: DAG canvas read-only
  Phase 14: task inspector and trace viewer
  Phase 15: live mock execution UX
  Phase 16: conflict/gate visualization
  Phase 17: import Claude Design UI and polish

Real execution
  Phase 18: real worktree runner without LLM
  Phase 19: validation command runner
  Phase 20: real diff capture
  Phase 21: bottom-up integration model v0

Agentic execution
  Phase 22: agent adapter interface hardening
  Phase 23: Claude Code/Codex/Aider adapter behind feature flag
  Phase 24: one-task real agent pilot
  Phase 25: multi-leaf real agent pilot

Experimental thesis
  Phase 26: benchmark v1 executable target repo
  Phase 27: experiment protocol
  Phase 28: collect pilot results
  Phase 29: analyze results and threats to validity
  Phase 30: final thesis report and defense demo
```

## Completed Foundation

### Phase 0 - Repository Setup

Status: complete.

Delivered:

- pnpm workspace;
- strict TypeScript;
- Vitest tests;
- ESLint;
- tsup package builds;
- package skeletons;
- development docs and ADRs.

### Phase 1 - Core Domain Models

Status: complete.

Delivered:

- task graph model and validation;
- agent task contract model and validation;
- deterministic conflict risk predictor;
- basic scheduler policies;
- in-memory trace store;
- stub agent runner boundary.

### Phase 2 - Deterministic Mock Decomposer

Status: complete.

Delivered:

- `@manyhands/decomposer`;
- deterministic `MockDecomposer`;
- passwordless-login feature fixture;
- coarse, balanced and fine decomposition modes;
- graph and contract validation;
- mock planning flow in `@manyhands/core`;
- in-memory trace events for planning;
- `pnpm demo:plan`.

### Phase 3 - Mock Worktree Runner + Scope Validation

Status: complete.

Delivered:

- `@manyhands/scope-validation`;
- deterministic `MockWorktreeRunner`;
- simulated worktree sessions, branches, diffs and validation checks;
- scope validation against allowed and forbidden paths;
- mock execution flow in `@manyhands/core`;
- execution trace events;
- `pnpm demo:execute:mock`;
- optional JSON export under an explicit flag.

### Phase 4 - Persistent Run Snapshots

Status: complete.

Delivered:

- `@manyhands/run-store`;
- versioned `RunSnapshot` schema;
- deterministic input and output hashes;
- JSON run store under `.manyhands/runs`;
- explicit run export/import;
- basic run history CLI commands;
- ADR documenting JSON-before-SQLite.

### Phase 5 - Static Conflict Signals v0

Status: complete.

Delivered:

- `@manyhands/repository-index`;
- TypeScript AST repository indexer v0;
- `examples/repos/aprobado-lite` fixture;
- static conflict signals from contracts plus repository index;
- optional enhanced risk matrix;
- repository index metadata in run snapshots;
- `pnpm demo:index:repo`;
- `pnpm demo:execute:mock -- --with-static-signals`.

### Phase 6 - Evaluator v0 + Granularity Comparison

Status: complete.

Delivered:

- `@manyhands/evaluator`;
- `EvaluationReport` schema `manyhands.evaluation-report.v1`;
- metrics for graph, contracts, conflict risk, scheduling, mock execution, traceability and coordination;
- methodological warnings for mock-only runs;
- deterministic report hash;
- granularity comparison over `coarse`, `balanced` and `fine`;
- `pnpm demo:compare:granularity`;
- optional report export and snapshot saving.

### Phase 7 - Benchmark Dataset v0

Status: complete.

Delivered:

- `benchmarks/mock-v0` manifest with five controlled feature fixtures;
- B0-B3 benchmark configurations;
- `SingleTaskDecomposer` for structural single-task baseline B0;
- `MetadataDrivenMockDecomposer` for multi-feature deterministic decomposition;
- `BenchmarkManifest` and `BenchmarkReport` schemas;
- aggregate metrics by configuration in `@manyhands/evaluator`;
- mock benchmark orchestration in `@manyhands/core`;
- `pnpm demo:benchmark:mock`;
- optional report export and run snapshot saving.

### Phase 8 - Controlled Conflict Scenarios + B4

Status: complete.

Delivered:

- `benchmarks/conflict-v0` with five controlled conflict fixtures;
- B4 `human_gated_mock`;
- pure human-gate wrapper over `risk_aware` scheduling;
- gate trace events;
- benchmark report v2 with human gate metrics;
- deterministic mock scope violation fixture;
- `pnpm demo:benchmark:conflicts`.

## Productization

### Phase 9 - Product Vision Alignment + Web App Prep

Priority: P0 critical for demo.

Depends on: Phase 0-8.

Objective: Reframe ManyHands as a visual orchestration product with a Lab Mode, and prepare the documentation surface for web app work.

Deliverables:

- updated README and architecture docs;
- product vision, UI vision, web app roadmap and thesis plan;
- ADR documenting the roadmap realignment;
- explicit MVP definitions.

Out of scope:

- functional UI implementation;
- schema changes;
- runner changes;
- benchmark logic changes.

Thesis relation: Establishes a defendable narrative for a thesis-product: artifact first, controlled evaluation second, empirical claims later.

### Phase 10 - Web App Foundation

Status: complete for the current foundation slice.

Priority: P0 critical for demo.

Depends on: Phase 9.

Objective: Create a minimal web app shell that can host future graph, report and run views.

Deliverables:

- Next.js App Router foundation under `apps/web`;
- Tailwind and shadcn/ui setup if adopted;
- main app layout with navigation for Build, Lab and Replay modes;
- placeholder pages wired to the eventual API contract;
- no duplicated domain logic in the frontend.

Out of scope:

- complex DAG canvas;
- real agent execution;
- desktop packaging;
- persistent database.

Thesis relation: Makes the artifact demonstrable as a product, not just as a CLI harness.

### Phase 11 - API Layer Over Existing Core

Status: partially complete for benchmark endpoints and a demo snapshot endpoint.

Priority: P0 critical for demo.

Depends on: Phase 10.

Objective: Expose the current deterministic core through real web API endpoints.

Deliverables:

- health endpoint;
- benchmark listing and detail endpoints;
- endpoint to run existing mock benchmark flows;
- endpoint to generate one deterministic demo `RunSnapshot`;
- typed response models derived from existing schemas where possible.

Still deferred:

- run listing and run detail endpoints;
- report detail endpoint;
- persisted report history.

Out of scope:

- WebSockets;
- real subprocess execution;
- changing core schemas for UI convenience;
- authentication.

Thesis relation: Preserves the separation between product UI and evaluated core, which makes the artifact easier to explain and test.

### Phase 12 - Benchmark/Report Viewer

Priority: P0 critical for demo.

Depends on: Phase 11.

Objective: Let users inspect existing `BenchmarkReport` artifacts through the web app.

Deliverables:

- B0-B4 comparison table;
- aggregate metrics by configuration;
- methodological warnings panel;
- report metadata and hash display;
- links from report rows to run snapshots when available.

Out of scope:

- new evaluator metrics;
- statistical claims;
- real quality scoring.

Thesis relation: Turns Lab Mode evidence into a readable evaluation artifact for advisors and defense.

### Phase 13 - DAG Canvas Read-only

Status: prepared, not implemented.

Priority: P0 critical for demo.

Depends on: Phase 11.

Objective: Render a `RunSnapshot` as a visual DAG without allowing graph edits yet.

Deliverables:

- React Flow or equivalent graph canvas;
- nodes grouped by phase/depth/status;
- dependency edges;
- risk/conflict edges as a distinct visual layer;
- minimap, zoom and pan;
- status counters and filters.

Prepared inputs:

- `/api/demo/run-snapshot` returns a real deterministic `RunSnapshot`;
- `/replay/demo` gives the next implementation a route to replace;
- `apps/web/src/lib/graph-view-model.ts` defines the first UI-facing nodes and edges contract.

Out of scope:

- live execution;
- editing nodes or dependencies;
- automatic layout perfection;
- custom node splitting.

Thesis relation: Makes decomposition, scheduling and conflict evidence observable, which strengthens the traceability argument.

### Phase 14 - Task Inspector + Trace Viewer

Priority: P0 critical for demo.

Depends on: Phase 13.

Objective: Give each selected task an inspection surface grounded in existing core artifacts.

Deliverables:

- task contract inspector;
- allowed and forbidden path display;
- dependency list;
- static signal and conflict evidence view;
- trace event stream;
- simulated diff and validation result display.

Out of scope:

- real diff application;
- editing contracts;
- LLM prompt generation.

Thesis relation: Shows that ManyHands is not merely drawing a graph; it exposes the contract and evidence model behind each leaf.

### Phase 15 - Live Mock Execution UX

Priority: P0 critical for demo.

Depends on: Phase 13 and Phase 14.

Objective: Make mock execution feel like the product workflow while still using deterministic core behavior.

Deliverables:

- `Run ready tasks` action;
- simulated batch progression;
- node status transitions;
- terminal-like trace stream;
- snapshot export after execution;
- reset/replay controls.

Out of scope:

- real worktree creation;
- background job infrastructure beyond what the demo needs;
- real agent adapters.

Thesis relation: Demonstrates orchestration mechanics before introducing external agent variance.

### Phase 16 - Conflict/Gate Visualization

Priority: P0 critical for demo.

Depends on: Phase 15.

Objective: Make risk-aware scheduling and B4 human-gated mock behavior visible.

Deliverables:

- high and blocking risk edge styling;
- gate-required markers;
- serialized-by-gate indicators;
- mock human review decision panel;
- comparison between naive, risk-aware and human-gated schedules.

Out of scope:

- real human approval workflow;
- real merge conflict handling;
- changing scheduler semantics.

Thesis relation: Directly supports the claim that conflict-aware orchestration can be audited and compared.

### Phase 17 - Import Claude Design UI and Polish

Priority: P1 important.

Depends on: Phase 13 through Phase 16.

Objective: Adapt the existing Claude Design DAG canvas direction into maintainable React components connected to real data.

Deliverables:

- visual system aligned with the generated design;
- reusable task card, edge, toolbar, inspector and metric components;
- responsive layout for laptop and large-screen demos;
- search, filters, minimap and keyboard affordances;
- desktop-like product feel without shipping desktop packaging yet.

Out of scope:

- reimplementing the UI as static HTML only;
- replacing validated data flows with design-only mock state;
- multi-user collaboration.

Thesis relation: Improves demo clarity and helps non-technical evaluators understand the artifact.

## Real Execution

### Phase 18 - Real Worktree Runner Without LLM

Priority: P1 important.

Depends on: Phase 15.

Objective: Replace simulated worktree metadata with a real git worktree lifecycle while keeping the "agent" deterministic or dummy.

Deliverables:

- create and clean up git worktrees;
- create real branches;
- run a deterministic local command or script;
- collect changed files;
- enforce scope validation on real file changes.

Out of scope:

- LLM agents;
- automatic merging;
- long-running job orchestration.

Thesis relation: Bridges mock orchestration and real repository effects without conflating results with LLM behavior.

### Phase 19 - Validation Command Runner

Priority: P1 important.

Depends on: Phase 18.

Objective: Execute declared validation commands in the real worktree under controlled conditions.

Deliverables:

- command allowlist or safe execution policy;
- stdout, stderr and exit code capture;
- timeout handling;
- validation result mapping back to `AgentRunResult`;
- UI display of real validation results.

Out of scope:

- arbitrary shell execution without guardrails;
- cloud sandboxing;
- multi-language build support beyond the target fixture.

Thesis relation: Establishes real objective evidence for later pilot runs.

### Phase 20 - Real Diff Capture

Priority: P1 important.

Depends on: Phase 18.

Objective: Capture and persist real diffs produced by dummy or scripted execution.

Deliverables:

- unified diff capture;
- changed files list from git;
- scope violations from real paths;
- snapshot storage of real runner metadata;
- UI diff view.

Out of scope:

- semantic diff analysis;
- automatic conflict resolution.

Thesis relation: Enables traceability from task contract to repository change.

### Phase 21 - Bottom-up Integration Model v0

Priority: P1 important.

Depends on: Phase 20.

Objective: Define and prototype how completed leaf outputs combine into parent objectives.

Deliverables:

- integration order model from the DAG;
- parent completion semantics;
- merge or patch-application strategy for the narrow target repo;
- integration trace events;
- failure and conflict representation.

Out of scope:

- robust generic merge automation;
- semantic conflict solving;
- automatic PR creation.

Thesis relation: Connects the orchestration architecture to the final "completed parent objective" claim.

## Agentic Execution

### Phase 22 - Agent Adapter Interface Hardening

Priority: P1 important.

Depends on: Phase 18 through Phase 21.

Objective: Prepare the runner boundary for real coding agents without committing to one provider.

Deliverables:

- adapter capability model;
- contract-to-prompt mapping draft;
- output capture contract;
- token/cost metadata fields where available;
- feature flag strategy.

Out of scope:

- production credential management;
- multi-provider parity;
- benchmark claims with agents.

Thesis relation: Keeps the real-agent pilot methodologically controlled.

### Phase 23 - Claude Code/Codex/Aider Adapter Behind Feature Flag

Priority: P1 important.

Depends on: Phase 22.

Objective: Add one real agent adapter behind an explicit opt-in path.

Deliverables:

- one adapter implementation;
- explicit local configuration;
- prompt generated from `AgentTaskContract`;
- captured diff and validation results;
- warnings about non-determinism and cost.

Out of scope:

- default-on agent execution;
- unattended multi-agent runs;
- provider comparison.

Thesis relation: Starts the transition from structural evaluation to pilot evidence without compromising the mock baseline.

### Phase 24 - One-task Real Agent Pilot

Priority: P1 important.

Depends on: Phase 23.

Objective: Run one atomic leaf task with a real agent in a controlled target repo.

Deliverables:

- fixed repo commit;
- one approved contract;
- one real agent run;
- diff capture;
- validation results;
- run snapshot with warnings.

Out of scope:

- multi-agent parallelism;
- broad benchmark conclusions.

Thesis relation: Validates that the product architecture can host real agent execution.

### Phase 25 - Multi-leaf Real Agent Pilot

Priority: P2 optional.

Depends on: Phase 24 and Phase 21.

Objective: Execute a small set of independent or lightly dependent leaves with real agents.

Deliverables:

- two to four leaf tasks;
- conflict-aware scheduling;
- real diffs;
- validation commands;
- integration attempt or documented manual integration.

Out of scope:

- large-scale experiments;
- statistical conclusions;
- unsupervised merges.

Thesis relation: Provides exploratory evidence for the final discussion if time allows.

## Experimental Thesis

### Phase 26 - Benchmark v1 Executable Target Repo

Priority: P1 important.

Depends on: Phase 19 through Phase 24.

Objective: Define a small executable target repository for real evaluation.

Deliverables:

- frozen target commit;
- `aprobado-lite` or another small executable target app selected explicitly;
- runnable install/test commands;
- small set of feature tasks;
- baseline validation procedure;
- documented fixture limitations.

Out of scope:

- SWE-bench scale;
- multi-language support;
- production workloads.

Thesis relation: Provides a controlled but real environment for final evidence.

### Phase 27 - Experiment Protocol

Priority: P1 important.

Depends on: Phase 26.

Objective: Define the thesis evaluation protocol before collecting results.

Deliverables:

- research question and hypotheses;
- configurations to compare;
- metrics;
- repetition/seed policy if feasible;
- threats-to-validity template;
- cost and time budget.

Out of scope:

- post-hoc metric invention;
- unsupported statistical claims.

Thesis relation: Makes the evaluation defensible.

### Phase 28 - Collect Pilot Results

Priority: P1 important.

Depends on: Phase 27.

Objective: Run the approved experimental slice and export evidence.

Deliverables:

- saved snapshots;
- benchmark reports;
- validation outputs;
- UI screenshots or recorded demo;
- notes on failures and deviations.

Out of scope:

- tuning the system after seeing results without documenting the change;
- claiming generality beyond the pilot.

Thesis relation: Produces the evidence base.

### Phase 29 - Analyze Results and Threats to Validity

Priority: P1 important.

Depends on: Phase 28.

Objective: Interpret the pilot honestly.

Deliverables:

- metrics tables;
- qualitative trace analysis;
- limitations;
- threats to validity;
- comparison with literature;
- distinction between mock, real-runner and real-agent evidence.

Out of scope:

- overstating mock results;
- presenting one pilot as proof of universal improvement.

Thesis relation: Forms the analytical core of the written thesis.

### Phase 30 - Final Thesis Report + Defense Demo

Priority: P0 critical for defense.

Depends on: Phase 29 and a stable product demo.

Objective: Package the artifact, evidence and narrative for defense.

Deliverables:

- final written report;
- reproducible demo script;
- exported evidence bundle;
- architecture diagrams;
- ADR summary;
- product walkthrough.

Out of scope:

- production launch;
- enterprise multi-user hardening;
- model training.

Thesis relation: Final deliverable.

## What Counts As MVP?

### MVP A - Visual Mock Orchestration Demo

This is the critical demo target.

Must include:

- web app;
- API routes over the real existing core;
- DAG canvas;
- benchmark report viewer;
- run snapshot viewer;
- live mock execution;
- conflict and gate visualization.

Success criterion: a viewer can understand how a developer goal becomes a task DAG, how ready work is scheduled, why some tasks are serialized and what evidence is captured.

### MVP B - Real Worktree Execution Slice

This is the bridge from mock to real repository effects.

Must include:

- real worktree creation;
- real branch creation;
- real command runner;
- real diff capture;
- real validation commands;
- no LLM required.

Success criterion: one deterministic task changes a real worktree, validates, produces a diff and is represented in a snapshot and UI.

### MVP C - Agentic Execution Slice

This is the first controlled real-agent milestone.

Must include:

- Claude Code, Codex or Aider adapter;
- `AgentTaskContract -> prompt`;
- execution of one or a few real leaf tasks;
- diff capture;
- validation;
- traceability.

Success criterion: ManyHands can supervise a narrow agentic run without pretending it is a full empirical benchmark.

## Superseded Priorities

The previous Phase 9/10 direction named SQLite or deeper static analysis before UI. Those remain valid future capabilities, but they are no longer the immediate product priority.

SQLite should wait until dashboard history, querying or multi-run exploration outgrow JSON snapshots. Deeper TypeScript semantic analysis should wait until the UI can show current structural evidence clearly and real execution begins to reveal which signals matter.
