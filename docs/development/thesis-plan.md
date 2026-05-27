# Thesis Plan

## Thesis Framing

ManyHands is a thesis-product: a technical artifact, an architectural design and an evaluation platform.

The thesis should present ManyHands as:

- a software artifact for visual multi-agent orchestration;
- a domain model for recursive task decomposition, atomic leaf contracts, conflict-aware scheduling and traceability;
- a controlled laboratory for comparing orchestration strategies;
- a product demo that makes the architecture visible and defensible.

The product and thesis are connected, but the evidence must remain carefully separated by stage. Mock results validate structure and reproducibility; they are not final empirical proof of real agent performance.

## Research Question

Spanish formulation:

```txt
Puede una arquitectura de orquestacion basada en descomposicion recursiva,
ejecucion paralela aislada y scheduling consciente de conflictos mejorar la
coordinacion, trazabilidad y robustez de agentes LLM de software frente a
estrategias monoliticas o paralelas naive?
```

English formulation:

```txt
Can an orchestration architecture based on recursive decomposition, isolated
parallel execution and conflict-aware scheduling improve the coordination,
traceability and robustness of LLM software agents compared with monolithic or
naive parallel strategies?
```

## Evaluation Path

### Stage 1 - Mock Structural Evaluation

Status: implemented.

Includes:

- B0-B4 configurations;
- `mock-v0`;
- `conflict-v0`;
- structural metrics;
- run snapshots;
- benchmark reports;
- methodological warnings.

Purpose: validate that the architecture can produce reproducible comparisons of graph shape, scheduling behavior, risk evidence, gate decisions and traceability.

Limits: no real agents, no real worktrees, no real tests and no final empirical evidence.

### Stage 2 - Visual Orchestration Validation

Status: next.

Includes:

- web UI;
- API layer over core;
- DAG canvas;
- report viewer;
- run snapshot viewer;
- observability through inspector and trace view;
- reproducible demo.

Purpose: show that the artifact is understandable and usable as an orchestration workspace, not only as a CLI benchmark.

Limits: still mock execution unless later stages are complete.

### Stage 3 - Real Execution Slice

Status: future.

Includes:

- real git worktrees;
- dummy or deterministic runner;
- real branches;
- real diffs;
- real validation commands;
- scope validation over real changed files.

Purpose: prove that the architecture can supervise real repository effects before introducing LLM variance.

Limits: no LLM agent required.

### Stage 4 - Agentic Execution Pilot

Status: future.

Includes:

- one real agent adapter;
- one or a few atomic leaf tasks;
- controlled repository;
- diff capture;
- validation;
- traceability;
- explicit cost and non-determinism warnings.

Purpose: provide a small exploratory bridge from the artifact to real agent behavior.

Limits: not a broad benchmark and not enough for universal claims.

### Stage 5 - Final Analysis

Status: future.

Includes:

- results by evidence stage;
- limitations;
- threats to validity;
- comparison with literature;
- discussion of product design;
- recommendations for future work.

Purpose: defend the thesis without overstating what each stage proves.

## Thesis Deliverables

- web application demo;
- core library packages;
- benchmark fixtures;
- run snapshots;
- evaluation reports;
- architecture documentation;
- ADRs;
- demo script;
- final written report;
- defense presentation.

## Evidence Separation

Use this distinction consistently:

- Mock structural evidence: deterministic architecture validation.
- Visual product evidence: usability and explainability of orchestration.
- Real runner evidence: repository effects without LLM variance.
- Real agent pilot evidence: exploratory feasibility.
- Final thesis conclusions: scoped claims based on the evidence actually collected.

## Methodological Warnings

The thesis should not claim:

- that B0 is a real single-agent baseline;
- that B4 is real human review;
- that blocking risk proves a real merge conflict;
- that mock duration equals real wall-clock performance;
- that structural reports measure final code quality;
- that one pilot generalizes to all LLM coding agents.

## Suggested Final Narrative

ManyHands first builds a deterministic orchestration core and laboratory to make decomposition, contracts, scheduling and conflict evidence reproducible. It then exposes that core through a visual product interface so a developer can understand and supervise multi-agent software work. Finally, it introduces real execution and real agents in controlled slices, using the same trace and evaluation model to keep the thesis evidence auditable.
