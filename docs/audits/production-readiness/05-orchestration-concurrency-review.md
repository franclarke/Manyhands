# 05 — Orchestration & Scheduler Concurrency Technical Audit

**Audit Date**: 2026-07-21  
**Target Packages**: `packages/task-graph`, `packages/decomposer`, `packages/orchestrator-graph`, `packages/scheduler`, `packages/conflict-risk`, `packages/contracts`  
**Target Specs**: `docs/system/01-task-graph.md`, `docs/system/02-planning-and-compilation.md`, `docs/system/04-execution-layer.md`, `docs/system/13-conflict-risk.md`  
**Auditor**: Teamwork Explorer (Orchestration & Task Graph Specialist)  

---

## 1. Orchestration Subsystem Overview

The orchestration subsystem compiles software goals into DAG `GraphRevision` structures, evaluates artifact readiness via `packages/scheduler`, and drives execution using `V2ExecutionDriver` over `RunCoordinator` state events. 

While the V2 architecture properly decouples immutable graph structure from runtime node status reductions, the audit uncovered **10 critical concurrency and graph compilation issues**.

---

## 2. Audit Findings Inventory (`MH-AUDIT-ORCH-xxx`)

| Issue ID | Severity | Component | File & Lines | Short Description |
|---|---|---|---|---|
| `MH-AUDIT-ORCH-001` | **P1 (High)** | Graph Validation | `packages/task-graph/src/validate-v2.ts:44-88` | `validateGraphRevision` checks parentage cycles (`parentId`) but omits `ArtifactRequirement` DAG cycle validation. |
| `MH-AUDIT-ORCH-002` | **P1 (High)** | Wave Selector | `packages/scheduler/src/wave-selector-v2.ts:32-79` | `selectReadyWaveV2` evaluates artifact readiness but completely ignores `ConflictConstraint` records in `GraphRevision`. |
| `MH-AUDIT-ORCH-003` | **P1 (High)** | Execution Driver | `packages/orchestrator-graph/src/v2/execution-driver.ts:112-160` | Chained `recording` promise mutation in `V2ExecutionDriver` causes unhandled rejections across parallel wave attempts. |
| `MH-AUDIT-ORCH-004` | **P1 (High)** | Decomposer Critic | `packages/decomposer/src/critics/scope-critic.ts:45-78` | `reviewScopes` in decomposer critics rejects planned modifications to existing target repository files. |
| `MH-AUDIT-ORCH-005` | **P2 (Medium)** | Readiness Calc | `packages/scheduler/src/readiness-v2.ts:55-89` | Seam binding artifact requirements evaluate ready status without verifying snapshot artifact hashes. |
| `MH-AUDIT-ORCH-006` | **P2 (Medium)** | Graph Adapter | `packages/task-graph/src/legacy-adapter.ts:40-75` | Legacy graph adapter embeds mutable node runtime state inside `TaskNode`, violating target spec separation. |
| `MH-AUDIT-ORCH-007` | **P2 (Medium)** | Contract Compiler | `packages/decomposer/src/compiler/contract-compiler.ts:90-120` | Contract compiler generates duplicate artifact IDs when composite leaves share seam bindings. |
| `MH-AUDIT-ORCH-008` | **P2 (Medium)** | Execution Driver | `packages/orchestrator-graph/src/v2/execution-driver.ts:210-240` | In-flight cancellation fails to interrupt running wave promises when human decision blocks arrive. |
| `MH-AUDIT-ORCH-009` | **P3 (Low)** | Graph Revision | `packages/task-graph/src/graph-revision.ts:60` | `reviseGraph` lacks revision ID idempotency validation for identical graph revisions. |
| `MH-AUDIT-ORCH-010` | **P3 (Low)** | Conflict Risk | `packages/conflict-risk/src/analyzer.ts:110` | Conflict risk score rounding drops decimal precision required for fine-grained risk ranking. |

---

## 3. Deep Dive Analysis & Code Evidence

### `MH-AUDIT-ORCH-001`: DAG Cycle Validation Omits `ArtifactRequirement` Edges
- **File**: `packages/task-graph/src/validate-v2.ts:44-88`
- **Analysis**: `validateGraphRevision` uses Depth-First Search (DFS) to traverse `node.parentId` hierarchies to detect parent-child cycles. However, nodes in ManyHands depend on outputs produced by other nodes via `ArtifactRequirement` schema (`node.consumesArtifactIds` -> `producingNodeId`). `validateGraphRevision` does *not* build an adjacency graph for artifact consumer-producer relationships.
- **Impact**: A graph containing a circular dependency (e.g. Node A consumes Artifact 1 produced by Node B, while Node B consumes Artifact 2 produced by Node A) passes `validateGraphRevision` without error. When executed, `selectReadyWaveV2` deadlocks permanently because neither node ever becomes ready.

### `MH-AUDIT-ORCH-002`: Scheduler Ignores Compiled `ConflictConstraint` Records
- **File**: `packages/scheduler/src/wave-selector-v2.ts:32-79`
- **Analysis**: `GraphRevision` permits declaring `ConflictConstraint` relationships between nodes that modify shared resources or state. However, `selectReadyWaveV2` only evaluates whether `node.readiness === "ready"`. It does not inspect `revision.conflictConstraints` or query `ConflictRiskAnalyzer` before including multiple ready nodes in the same execution wave.
- **Impact**: Two ready nodes marked with an explicit `ConflictConstraint` are dispatched simultaneously in the same parallel execution wave, causing Git branch collision and dirty file conflicts.
