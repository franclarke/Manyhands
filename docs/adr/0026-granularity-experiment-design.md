# 0026 · Granularity experiment design: vectors, baselines, and fixture

## Status

Accepted. `GranularityVectorSchema` defined in `packages/execution-core`. Fixture planned at `benchmarks/task-manager-api/`.

## Context

ManyHands' thesis question: *Is there an optimal DAG decomposition granularity that maximizes the quality of parallel LLM agent output?* To answer this, we need: (a) a metric vector that captures both DAG structure and execution outcomes, (b) controlled baselines that isolate variables, and (c) a reproducible fixture repository.

## Decision

### GranularityVector

A 17-field metric record with two sections:

**Pre-execution (DAG structure — computed before any agent runs):**
- `depth`, `leafCount`, `compositeCount`: basic DAG shape.
- `avgLeafDepth`, `maxLeafDepth`: how deep leaves sit in the hierarchy.
- `dependencyCount`: inter-task dependency edges.
- `avgAcceptanceCriteriaPerLeaf`: specification density.
- `estimatedTokensPerLeaf` (optional): heuristic prompt size estimate.

**Post-execution (results — computed after the run completes):**
- `integrationSuccessRate`, `leafSuccessRate`: 0–1 success ratios.
- `conflictRate`: fraction of leaf pairs with file conflicts.
- `totalDurationMs`, `totalCostUsd`: resource consumption.
- `testsPassedRate`: 0–1, if validation commands are configured.
- `linesChanged`: total diff size.
- `unexpectedCommitCount`, `scopeViolationCount`: policy violation counts.

### Baselines (B0–B4)

| Baseline | Description | Variables |
|----------|-------------|-----------|
| B0 | Single agent, no decomposition | 1 leaf, no DAG |
| B1 | Sequential DAG (one leaf at a time) | DAG structure, no parallelism |
| B2 | Parallel naive (all leaves at once) | DAG + parallelism, no integration |
| B3 | Parallel + IntegrationAgent | DAG + parallelism + cherry-pick |
| B4 | Parallel + risk-aware + IntegrationAgent | Full pipeline |

### Granularity targets

- **G3** (~3 leaves): coarse decomposition.
- **G6** (~6 leaves): balanced decomposition.
- **G9** (~9 leaves): fine decomposition.

Each experiment runs all 5 baselines × 3 granularity targets = 15 configurations against the same fixture and prompt.

### Fixture repository

`benchmarks/task-manager-api/`: a simple Express REST API with TypeScript and tests. Partially implemented (GET/POST work, PUT/DELETE are stubs). Agents complete the implementation. Tests define expected behavior — passing tests is the primary quality signal.

## Consequences

Positive:
- Controlled comparison across granularities and execution strategies.
- GranularityVector captures both structural and outcome dimensions — enables correlation analysis.
- The fixture is simple enough for agents to complete in minutes but complex enough to expose conflicts.

Negative / accepted:
- 15 configurations × N repetitions is expensive in LLM tokens. Mitigated: start with 1 repetition per config, increase for statistical significance later.
- A single fixture limits generalizability. Accepted: additional fixtures can be added later (the vector schema is fixture-independent).
- `estimatedTokensPerLeaf` is a heuristic — not precise. Accepted: directional signal is sufficient.

## Alternatives considered

- **Real-world repository as fixture**: rejected for V1 — too many confounding variables (repo size, existing bugs, framework complexity).
- **Synthetic code generation tasks**: rejected — unrealistic for measuring integration quality.
- **Fewer baselines**: rejected — each baseline isolates a specific variable. Removing one weakens causal inference.

## References

- `packages/execution-core/src/types.ts`: `GranularityVectorSchema`
- `CLAUDE.md`: Experiment design section, Baselines B0–B4, GranularityVector interface
- `benchmarks/task-manager-api/` (created in same etapa)
