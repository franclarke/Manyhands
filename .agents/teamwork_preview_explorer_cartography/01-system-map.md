# ManyHands System Map — Architectural Inventory & Cartography

**Auditor**: `teamwork_preview_explorer` (Cartography & Architecture Specialist)  
**Date**: 2026-07-21  
**Repository Target**: `c:\Users\franc\Documents\Proyectos\Manyhands`

---

## 1. Executive Topology & Monorepo Architecture

ManyHands is organized as a `pnpm` monorepo containing **1 Web Application** (`apps/web`) and **12 Domain Packages** (`packages/*`).

```
                    ┌──────────────────────────────┐
                    │      apps/web (Next.js)      │
                    └──────────────┬───────────────┘
                                   │
  ┌────────────────────────────────┼────────────────────────────────┐
  │                                │                                │
  ▼                                ▼                                ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ @manyhands/         │  │ @manyhands/         │  │ @manyhands/         │
│ orchestrator-graph  │  │ run-coordinator     │  │ execution-core      │
└──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘
           │                        │                        │
           └────────────────────────┼────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────┬───────────────┬──────────────────────────┐
│ @manyhands/task-graph     │ @manyhands/   │ @manyhands/scheduler     │
│ @manyhands/contracts      │ run-store     │ @manyhands/conflict-risk │
└─────────────┬─────────────┴───────┬───────┴─────────────┬────────────┘
              │                     │                     │
              ▼                     ▼                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ @manyhands/repository-index   @manyhands/trace-store                 │
│ @manyhands/shared                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Target Architecture vs Current Implementation Matrix

| Package / App | Target Spec Document | Target Design | Current Implementation State | Transition Status | Evidence Tag |
|---|---|---|---|---|---|
| `apps/web` | `docs/system/10-web-app.md` | Single run workspace view, reactive canvas, decision queue | Next.js 15 app router hosting workspace & run store API endpoints. Dual projections for run state. | Partial | `Confirmado` |
| `packages/shared` | `AGENTS.md` | Base utilities & canonical zod schemas | Shared schemas (EntityId, IsoTimestamp), executor registry, and CLI process runner. | Complete | `Confirmado` |
| `packages/task-graph` | `docs/system/01-task-graph.md` | Immutable `GraphRevision` V2 with typed relations | Dual models: legacy `TaskNode` with embedded runtime status vs V2 `GraphRevision` with typed relations. | Partial | `Confirmado` |
| `packages/contracts` | `docs/system/02-contracts.md` | `TaskContractBundle` (scope, seams, artifacts, validation) | Coexistence of legacy `AgentTaskContract` and target V2 `TaskContractBundleSchema`. | Partial | `Confirmado` |
| `packages/decomposer` | `docs/system/03-decomposer.md` | Planner (WBS) + Graph Compiler | Decomposer returns legacy `TaskGraph` & `AgentTaskContract[]`, but V2 compiler functions exist in `src/compiler/`. | Partial | `Confirmado` |
| `packages/execution-core` | `docs/system/04-run-executor.md`, `05-worktree-layer.md` | Materialized execution bases, attempts & candidate validation | Dual execution paths: legacy task runner (`src/run/executor.ts`) vs V2 Exact Candidate Validator (`src/v2/`). | Partial | `Confirmado` |
| `packages/orchestrator-graph` | `docs/system/09-composer.md` | State-less driver delegating lifecycle to RunCoordinator | Exports `V2ExecutionDriver` wrapping `RunCoordinator` facts. | Partial | `Confirmado` |
| `packages/run-coordinator` | `docs/system/04-run-executor.md`, `docs/DECISIONS.md` | Canonical event reducer & state machine | `RunCoordinator`, event reducer, lifecycle states, attempt fingerprinting & evidence matrix. | Complete | `Confirmado` |
| `packages/run-store` | `docs/system/08-result-pipeline.md` | Event-sourced disk persistence (JSONL) & artifact/attempt stores | `JsonlEventStore`, `SnapshotStore`, `ArtifactStore`, `AttemptStore`. | Complete | `Confirmado` |
| `packages/trace-store` | `docs/DECISIONS.md` | Diagnostic telemetry separate from state facts | `InMemoryTraceStore` capturing timing, CLI logs, routing, and debug events. | Complete | `Confirmado` |
| `packages/repository-index` | `docs/system/14-repository-index.md` | Immutable repo snapshot record & TS AST index | `buildRepositorySnapshotRecord`, symbol extraction, and capability discovery. | Complete | `Confirmado` |
| `packages/scheduler` | `docs/system/12-scheduler.md` | Artifact readiness & constraint wave selection | Coexistence of legacy task dependency batch scheduler and V2 `explainReadiness` / `selectReadyWaveV2`. | Partial | `Confirmado` |
| `packages/conflict-risk` | `docs/system/13-conflict-risk.md` | Conflict analysis & evidence signal calculator | `ConflictRiskAnalyzer` calculating file/symbol overlaps and constraint evidence. | Complete | `Confirmado` |

---

## 3. Workspace Cartography Detail (100% Coverage)

### 3.1 `apps/web`
- **Path**: `apps/web`
- **Entrypoints**: `src/app/layout.tsx`, `src/app/runs/[runId]/page.tsx`, `src/lib/server/runs/repository.ts`
- **Status**: Partial (`Confirmado`)
- **Public API / Exports**: Web application user interface & API routes (`/api/runs`, `/api/decompose`).
- **Internal Workspace Dependencies**: `@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/decomposer`, `@manyhands/execution-core`, `@manyhands/orchestrator-graph`, `@manyhands/repository-index`, `@manyhands/run-coordinator`, `@manyhands/run-store`, `@manyhands/scheduler`, `@manyhands/shared`, `@manyhands/task-graph`, `@manyhands/trace-store`.
- **External npm Dependencies**: Next.js 15, React 19, `@xyflow/react`, `@assistant-ui/react`, `@xterm/xterm`, `lucide-react`, `node-pty`, `react-resizable-panels`, `tailwindcss`, `zod`.
- **Architectural Gaps**: `apps/web/src/lib/server/runs/repository.ts` (lines 1-700) maintains an in-memory run store and legacy status mapping in parallel with V2 event-sourced projections (`Confirmado`).

### 3.2 `packages/shared`
- **Path**: `packages/shared`
- **Entrypoints**: `src/index.ts`, `src/executor-registry.ts`, `src/node-cli-process.ts`
- **Status**: Complete (`Confirmado`)
- **Public API / Exports**: `ReasoningEffortSchema`, `EntityIdSchema`, `IsoTimestampSchema`, `nowIso`, `EFFORT_LEVELS`, `CLI_EXECUTOR_ID`, `LANGGRAPH_EXECUTOR_ID`, `node-cli-process`.
- **Internal Workspace Dependencies**: None.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: `node-cli-process.ts` (`packages/shared/src/node-cli-process.ts`: lines 1-100) embeds Node process execution logic in the shared domain base (`Confirmado`).

### 3.3 `packages/task-graph`
- **Path**: `packages/task-graph`
- **Entrypoints**: `src/index.ts`, `src/graph-revision.ts`, `src/relations.ts`, `src/validate-v2.ts`, `src/legacy-adapter.ts`
- **Status**: Partial (`Confirmado`)
- **Public API / Exports**: `TaskGraphSchema`, `TaskNodeSchema`, `GraphRevisionSchema`, `TaskNodeV2Schema`, `ArtifactRequirementSchema`, `SeamBindingSchema`, `ConflictConstraintSchema`, `validateGraphV2`, `reviseGraph`, `legacyAdapter`.
- **Internal Workspace Dependencies**: `@manyhands/contracts`, `@manyhands/shared`.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: Legacy `TaskNode` embeds runtime node execution status inside the graph structure (`packages/task-graph/src/index.ts`: line 97). Target architecture spec `docs/system/01-task-graph.md` separates graph structure (`GraphRevision`) from runtime status (`RunCoordinator`) (`Confirmado`).

### 3.4 `packages/contracts`
- **Path**: `packages/contracts`
- **Entrypoints**: `src/index.ts`, `src/contract-bundle.ts`, `src/legacy-adapter.ts`
- **Status**: Partial (`Confirmado`)
- **Public API / Exports**: `TaskContractBundleSchema`, `TaskContractSchema`, `ScopeContractSchema`, `SeamContractSchema`, `ArtifactContractSchema`, `ValidationContractSchema`, `AgentTaskContractSchema`.
- **Internal Workspace Dependencies**: `@manyhands/shared`.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: Legacy `AgentTaskContractSchema` remains in active use across decomposer and legacy runner pipelines (`packages/contracts/src/legacy-adapter.ts`: line 1) (`Confirmado`).

### 3.5 `packages/decomposer`
- **Path**: `packages/decomposer`
- **Entrypoints**: `src/index.ts`, `src/compiler/graph-compiler.ts`, `src/compiler/contract-compiler.ts`, `src/planner/work-breakdown.ts`
- **Status**: Partial (`Confirmado`)
- **Public API / Exports**: `FeatureRequestSchema`, `DecompositionOptionsSchema`, `DecompositionResult`, `Decomposer`, `LLMDecomposer`, `DeterministicDecomposer`, `WorkBreakdownPlanner`, `compileGraphRevision`, `compileContractBundles`.
- **Internal Workspace Dependencies**: `@manyhands/contracts`, `@manyhands/repository-index`, `@manyhands/shared`, `@manyhands/task-graph`.
- **External npm Dependencies**: `@anthropic-ai/sdk`, `zod`.
- **Architectural Gaps**: Primary interface `DeconstructionResult` outputs legacy `TaskGraph` & `AgentTaskContract[]` (`packages/decomposer/src/index.ts`: lines 83-89), forcing consumers to invoke V2 Graph Compiler separately (`Confirmado`).

### 3.6 `packages/execution-core`
- **Path**: `packages/execution-core`
- **Entrypoints**: `src/index.ts`, `src/v2/exact-candidate-validator.ts`, `src/v2/node-executor.ts`, `src/worktree/manager.ts`, `src/base/execution-base-builder.ts`
- **Status**: Partial (`Confirmado`)
- **Public API / Exports**: `WorktreeManager`, `ExecutionBaseBuilder`, `CandidateValidator`, `ExactCandidateValidator`, `NodeExecutor`, `CLIExecutor`, `ProcessInspector`, `EvidenceMatrix`.
- **Internal Workspace Dependencies**: `@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/repository-index`, `@manyhands/scheduler`, `@manyhands/shared`, `@manyhands/task-graph`, `@manyhands/trace-store`.
- **External npm Dependencies**: `simple-git`, `typescript`, `zod`.
- **Architectural Gaps**: Coexistence of legacy task execution pipeline (`packages/execution-core/src/run/executor.ts`) with target V2 Exact Candidate Validator (`src/v2/exact-candidate-validator.ts`) (`Confirmado`).

### 3.7 `packages/orchestrator-graph`
- **Path**: `packages/orchestrator-graph`
- **Entrypoints**: `src/index.ts`, `src/v2/execution-driver.ts`
- **Status**: Partial (`Confirmado`)
- **Public API / Exports**: `V2ExecutionDriver`, `V2ExecutionDriverOptions`, `V2ExecutionRunInput`, `V2NodeExecutionOutcome`.
- **Internal Workspace Dependencies**: `@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/run-coordinator`, `@manyhands/scheduler`, `@manyhands/task-graph`.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: `V2ExecutionDriver` acts as an execution driver delegating events to `RunCoordinator`, but legacy graph orchestration logic persists in web server hosts (`Confirmado`).

### 3.8 `packages/run-coordinator`
- **Path**: `packages/run-coordinator`
- **Entrypoints**: `src/index.ts`, `src/coordinator.ts`, `src/reducer.ts`
- **Status**: Complete (`Confirmado`)
- **Public API / Exports**: `RunCoordinator`, `runCoordinatorReducer`, `RunDomainEventSchema`, `RunLifecycleState`, `InputFingerprint`, `HumanDecision`, `EvidenceMatrix`.
- **Internal Workspace Dependencies**: `@manyhands/shared`, `@manyhands/task-graph`.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: None. Aligns fully with `docs/system/04-run-executor.md` (`Confirmado`).

### 3.9 `packages/run-store`
- **Path**: `packages/run-store`
- **Entrypoints**: `src/index.ts`, `src/jsonl-event-store.ts`, `src/snapshot-store.ts`, `src/artifact-store.ts`, `src/attempt-store.ts`
- **Status**: Complete (`Confirmado`)
- **Public API / Exports**: `EventStore`, `JsonlEventStore`, `ArtifactStore`, `AttemptStore`, `SnapshotStore`, `EventUpcaster`.
- **Internal Workspace Dependencies**: `@manyhands/run-coordinator`, `@manyhands/shared`.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: None. Implements canonical JSONL event stream persistence (`Confirmado`).

### 3.10 `packages/trace-store`
- **Path**: `packages/trace-store`
- **Entrypoints**: `src/index.ts`
- **Status**: Complete (`Confirmado`)
- **Public API / Exports**: `TraceStore`, `InMemoryTraceStore`, `TraceEventSchema`, `TraceEventTypeSchema`.
- **Internal Workspace Dependencies**: `@manyhands/shared`.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: None. Implements diagnostic telemetry store separate from domain state events (`Confirmado`).

### 3.11 `packages/repository-index`
- **Path**: `packages/repository-index`
- **Entrypoints**: `src/index.ts`, `src/snapshot.ts`, `src/capabilities.ts`
- **Status**: Complete (`Confirmado`)
- **Public API / Exports**: `RepositoryIndexer`, `buildRepositorySnapshotRecord`, `createRepositorySnapshotSchema`, `discoverRepositoryCapabilities`, `RepositorySnapshotRecord`.
- **Internal Workspace Dependencies**: `@manyhands/shared`.
- **External npm Dependencies**: `typescript`, `zod`.
- **Architectural Gaps**: None. Aligns with `docs/system/14-repository-index.md` (`Confirmado`).

### 3.12 `packages/scheduler`
- **Path**: `packages/scheduler`
- **Entrypoints**: `src/index.ts`, `src/readiness-v2.ts`, `src/wave-selector-v2.ts`
- **Status**: Partial (`Confirmado`)
- **Public API / Exports**: `explainReadiness`, `selectReadyWaveV2`, `Scheduler`, `scheduleBatch`.
- **Internal Workspace Dependencies**: `@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/task-graph`.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: Coexistence of legacy task dependency batch scheduler and V2 `explainReadiness` artifact calculator (`packages/scheduler/src/readiness-v2.ts`) (`Confirmado`).

### 3.13 `packages/conflict-risk`
- **Path**: `packages/conflict-risk`
- **Entrypoints**: `src/index.ts`, `src/constraint-evidence.ts`
- **Status**: Complete (`Confirmado`)
- **Public API / Exports**: `ConflictRiskAnalyzer`, `analyzeConflictRisk`, `ConflictEvidenceSchema`, `ConflictRiskScoreSchema`, `ConflictConstraintEvidenceSchema`.
- **Internal Workspace Dependencies**: `@manyhands/contracts`, `@manyhands/repository-index`, `@manyhands/shared`.
- **External npm Dependencies**: `zod`.
- **Architectural Gaps**: None. Aligns with `docs/system/13-conflict-risk.md` (`Confirmado`).

---

## 4. Key Transition Gaps & Migration Vectors

1. **Dual Domain Event / Legacy State Projection Gap**:
   - `apps/web/src/lib/server/runs/repository.ts` maintains legacy state alongside V2 domain events (`Confirmado`).
   - *Target*: All run persistence and UI state projections must react solely to canonical `RunDomainEvent` logs emitted by `@manyhands/run-coordinator`.

2. **Graph Revision V2 vs TaskNode Status Gap**:
   - `@manyhands/task-graph` retains `status` on `TaskNode` (`packages/task-graph/src/index.ts`: line 97) (`Confirmado`).
   - *Target*: `GraphRevision` is immutable structural topology; node readiness and state transitions belong exclusively to `RunCoordinator` and `@manyhands/scheduler`'s `explainReadiness`.

3. **Contract Bundle V2 vs Legacy AgentTaskContract Gap**:
   - Decomposer and execution core continue to read/write legacy `AgentTaskContract` (`packages/contracts/src/legacy-adapter.ts`) (`Confirmado`).
   - *Target*: Direct generation and validation of `TaskContractBundle` (scope, seams, artifacts, validation obligations).

4. **Shared Package Process Leaks**:
   - `packages/shared/src/node-cli-process.ts` contains process execution helpers (`Confirmado`).
   - *Target*: Move process supervision to `@manyhands/execution-core`.
