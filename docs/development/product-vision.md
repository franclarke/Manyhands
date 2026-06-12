# Product Vision

## One-Liner

ManyHands is a visual orchestration workspace for multi-agent software
development.

## Product Thesis

A developer should be able to describe a software goal and supervise the full
life cycle of autonomous work:

```text
Describe goal
  -> Review decomposition
  -> Approve plan
  -> Watch isolated agents execute
  -> Answer high-impact decisions
  -> Inspect integration evidence
  -> Accept or fork the result
```

The product value is trust: the user sees what the system is doing, why it is
blocked, what changed in git, and what decisions still require human judgment.

## Users

- Francisco as solo developer/architect today.
- Developers experimenting with parallel coding agents.
- Technical reviewers who need to understand whether the orchestration is
  correct and inspectable.

Evaluation or thesis audiences are not active product targets until a new
quality-measurement strategy is designed.

## Core Workflow

1. The user describes a feature, module, application or change.
2. ManyHands decomposes the goal recursively into a hierarchical DAG.
3. The user reviews plan, dependencies, contracts and risk signals.
4. The user approves, edits or asks for regeneration.
5. ManyHands schedules ready leaf tasks as waves.
6. Leaf tasks run in isolated worktrees.
7. The system captures diffs, logs, validation, scope results and conflicts.
8. The Composer integrates completed children bottom-up.
9. Human gates appear only for high-impact decisions.
10. The final state can be inspected, accepted or forked.

## Current Product Modes

### Command Center

The entry point for creating runs. It collects prompt, workspace, model and
granularity configuration.

### Run Workspace

The main product surface. It combines:

- conversational decision channel;
- artifact surface for DAG/plan/conflicts/execution/files/evidence;
- focus panel for node/seam/conflict/decision details;
- SSE-backed event stream;
- lazy artifact resolution.

### Golden Fixture Prototype

`/runs/proto/[fixture]` replays event fixtures against the same reducer and
selectors used by the live UI. This is a regression harness for the UI model, not
a benchmark or quality-evaluation product mode.

## Future Evaluation

Quality evaluation is intentionally deferred. A future effort may use public
benchmarks, custom fixtures, real repositories, human review, or combinations of
those, but the methodology is not designed yet and should not be inferred from
old Lab Mode documents.

## What ManyHands Is Not

- not a complete IDE;
- not a replacement for the developer;
- not a SWE-bench clone;
- not a benchmark runner;
- not a monolithic coding agent;
- not an enterprise multi-user platform;
- not a model training system.

## Product Principles

- Visual first: graph, state and evidence should be visible.
- Core-backed: the web app consumes real orchestration artifacts.
- Human-guided: approval, arbitration and final acceptance stay with the user.
- Event-sourced UI: visible state is derived from `RunEvent`.
- Honest evidence: distinguish operational evidence from future evaluation
  claims.

