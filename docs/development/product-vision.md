# Product Vision

## One-liner

ManyHands is a visual orchestration workspace for multi-agent software development.

## Product Thesis

A developer should be able to describe a software goal and watch it become an executable, inspectable and reproducible plan:

```txt
Describe goal
  -> Review decomposition
  -> Inspect DAG
  -> Approve plan
  -> Run ready tasks
  -> Monitor subagents
  -> Resolve/gate conflicts
  -> Integrate bottom-up
  -> Export result/report
```

ManyHands is not only a benchmark runner. The benchmark is a lab instrument inside a broader product: a workspace that makes multi-agent software work visible, controllable and auditable.

## Users

- individual developer building a feature or app slice;
- AI-native engineer coordinating several coding agents;
- small team exploring parallel agent workflows;
- researcher or thesis evaluator studying orchestration strategies.

## Core Workflow

1. The user describes a feature, module, application or change.
2. ManyHands decomposes the goal recursively into a hierarchical DAG.
3. The user reviews the plan, dependencies, contracts and risk signals.
4. The user approves the plan or adjusts it.
5. ManyHands schedules ready atomic leaf tasks.
6. Leaf tasks run in isolation through mock, deterministic, real worktree or future agent runners.
7. The system tracks traces, validation, diffs, scope violations and conflict evidence.
8. Conflicts or high-risk pairs are serialized or gated.
9. Completed leaves are integrated bottom-up into parent objectives.
10. The run can be replayed, exported and compared.

## Product Modes

### Product Mode / Build Mode

Product Mode, also called Build Mode in the UI, is the main product mode.

The user describes a feature or app goal. ManyHands generates a DAG, exposes the plan visually, schedules executable leaves, supervises isolated runners and eventually integrates results into the parent objective.

Build Mode uses real execution: `GeminiCliExecutor` on provisioned fixture repos, with SSE events, real diffs, scope checks, validation, and bottom-up integration. The UI reflects real run state.

### Lab Mode

Lab Mode is the thesis and evaluation mode.

It runs benchmarks, compares configurations B0-B4, exports snapshots, generates reports and makes orchestration strategies reproducible. Lab Mode currently uses deterministic mock fixtures and methodological warnings.

Lab Mode validates the architecture before real agents are introduced. It should not be described as final empirical evidence.

### Replay Mode

Replay Mode is the demo and debugging mode.

It loads saved `RunSnapshot` and `BenchmarkReport` artifacts, visualizes the DAG, shows trace events, explains scheduling decisions and lets a viewer inspect why a run behaved the way it did.

Replay Mode is especially useful for defense demos because it removes live execution risk while preserving evidence.

### Future Desktop Mode

Desktop Mode is not implemented yet.

A future desktop app could run closer to the developer's local environment:

- local filesystem access;
- local git repositories;
- local git worktrees;
- subprocess execution;
- real coding agents;
- controlled permission prompts;
- local secrets and credential boundaries.

The current architecture should keep this option open by preserving clean boundaries between UI, API/core, runners and repository effects.

### Real Agent Mode

Real Agent Mode is implemented: leaf tasks are delegated to Gemini CLI (`GeminiCliExecutor`) via the provider-agnostic `AgentExecutor` interface. The pipeline covers diff capture, scope validation, validation commands, commit orchestration, and bottom-up integration.

What remains: running the full experiment matrix (B0-B4 × low/medium/high granularity) on real fixtures to collect empirical `GranularityVector` data. The infrastructure exists; the experiments have not been run yet.

## What ManyHands Is Not

- not a complete IDE;
- not a replacement for the developer;
- not a SWE-bench clone;
- not a monolithic coding agent;
- not an enterprise multi-user platform;
- not a model training system;
- not proof that mock benchmark results predict real code quality.

## Product Principles

- Visual first: the graph, state and evidence should be visible.
- Core-backed: the web app consumes real core artifacts, not unrelated UI mock data.
- Human-guided: approval, gating and interpretation stay with the developer.
- Reproducible: snapshots and reports are first-class.
- Mock before real: deterministic lab flows reduce risk before adding agent variance.
- Honest evidence: distinguish mock structure, real runner results and real agent results.
