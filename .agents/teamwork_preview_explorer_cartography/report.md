# ManyHands Codebase Cartography & Architecture Audit Report

**Role**: `teamwork_preview_explorer` (Cartography & Architecture Specialist)  
**Date**: 2026-07-21  
**Working Directory**: `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_cartography`

---

## 1. Executive Summary

This report delivers a 100% complete cartography and inventory audit of the ManyHands monorepo (`apps/`, `packages/`, `docs/`). Every application and package has been audited against the target architecture specification defined in `PRODUCT.md`, `AGENTS.md`, `docs/DECISIONS.md`, and system specifications in `docs/system/01-task-graph.md` through `docs/system/14-repository-index.md`.

### Key Metrics
- **Total Workspaces Audited**: 13 (1 App, 12 Packages)
- **Coverage**: 100%
- **Status Distribution**:
  - **Complete** (6 packages): `@manyhands/shared`, `@manyhands/run-coordinator`, `@manyhands/run-store`, `@manyhands/trace-store`, `@manyhands/repository-index`, `@manyhands/conflict-risk`
  - **Partial / Transition** (7 target units): `@manyhands/web`, `@manyhands/task-graph`, `@manyhands/contracts`, `@manyhands/decomposer`, `@manyhands/execution-core`, `@manyhands/orchestrator-graph`, `@manyhands/scheduler`
  - **Stub / Missing / Legacy**: 0

---

## 2. Methodology & Evidence Tags

All observations and findings in this audit are tagged with explicit evidence levels:
- **`[Confirmado]`**: Verified directly by inspecting line numbers in source files, build scripts, and package configurations.
- **`[Probable]`**: Inferred logically from dependency structures or adapter signatures across package boundaries.
- **`[Hipótesis]`**: Reasonable architectural projection requiring future runtime execution benchmarks.

---

## 3. Inventory & Cartography by Workspace

### 3.1 `apps/web`
- **Name & Path**: `@manyhands/web` (`apps/web`) `[Confirmado]`
- **Implementation Status**: Partial / Transition `[Confirmado]`
- **Main Entrypoints**:
  - `apps/web/src/app/layout.tsx` `[Confirmado]`
  - `apps/web/src/app/runs/[runId]/page.tsx` `[Confirmado]`
  - `apps/web/src/lib/server/runs/repository.ts` (lines 1-700) `[Confirmado]`
- **Public API Exports**: Next.js App Router Web UI application and API route endpoints (`/api/runs`, `/api/decompose`). `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/decomposer`, `@manyhands/execution-core`, `@manyhands/orchestrator-graph`, `@manyhands/repository-index`, `@manyhands/run-coordinator`, `@manyhands/run-store`, `@manyhands/scheduler`, `@manyhands/shared`, `@manyhands/task-graph`, `@manyhands/trace-store`. `[Confirmado]`
  - *External npm*: Next.js 15, React 19, `@xyflow/react`, `@assistant-ui/react`, `@xterm/xterm`, `lucide-react`, `node-pty`, `react-resizable-panels`, `tailwindcss`, `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**:
  - `apps/web/src/lib/server/runs/repository.ts` retains an in-memory run state store and legacy node status mapping in parallel with V2 domain event projections (`Confirmado`).
  - Web UI component views retain legacy imperative status logic alongside reactive React Flow canvas components (`Confirmado`).

### 3.2 `packages/shared`
- **Name & Path**: `@manyhands/shared` (`packages/shared`) `[Confirmado]`
- **Implementation Status**: Complete `[Confirmado]`
- **Main Entrypoints**:
  - `packages/shared/src/index.ts` (lines 1-48) `[Confirmado]`
  - `packages/shared/src/executor-registry.ts` `[Confirmado]`
  - `packages/shared/src/node-cli-process.ts` (lines 1-100) `[Confirmado]`
- **Public API Exports**: `ReasoningEffortSchema`, `EntityIdSchema`, `EntityId`, `IsoTimestampSchema`, `IsoTimestamp`, `nowIso`, `uniqueValues`, `intersectValues`, `clamp01`, `pairKey`, `EFFORT_LEVELS`, `AgentExecutorConfig`, `CLI_EXECUTOR_ID`, `LANGGRAPH_EXECUTOR_ID`, `node-cli-process`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: None. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**:
  - `packages/shared/src/node-cli-process.ts` implements Node child process management, leaking process supervision concerns into the shared domain base package (`Confirmado`).

### 3.3 `packages/task-graph`
- **Name & Path**: `@manyhands/task-graph` (`packages/task-graph`) `[Confirmado]`
- **Implementation Status**: Partial / Transition `[Confirmado]`
- **Main Entrypoints**:
  - `packages/task-graph/src/index.ts` (lines 1-981) `[Confirmado]`
  - `packages/task-graph/src/graph-revision.ts` (lines 1-57) `[Confirmado]`
  - `packages/task-graph/src/relations.ts` (lines 1-61) `[Confirmado]`
  - `packages/task-graph/src/validate-v2.ts` `[Confirmado]`
  - `packages/task-graph/src/legacy-adapter.ts` `[Confirmado]`
- **Public API Exports**: `TaskGraphSchema`, `TaskNodeSchema`, `TaskNodeStatusSchema`, `GraphRevisionSchema`, `TaskNodeV2Schema`, `ArtifactRequirementSchema`, `SeamBindingSchema`, `ConflictConstraintSchema`, `LegacyOrderingConstraintSchema`, `validateGraphV2`, `reviseGraph`, `legacyAdapter`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/contracts`, `@manyhands/shared`. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**:
  - Dual representations: legacy `TaskNode` stores runtime node status (`planned`, `running`, `done`) directly inside node objects (`packages/task-graph/src/index.ts`: line 97). Target spec `docs/system/01-task-graph.md` mandates that graph revisions are immutable structure snapshots (`GraphRevision`) while node lifecycle is managed solely by `RunCoordinator` (`Confirmado`).

### 3.4 `packages/contracts`
- **Name & Path**: `@manyhands/contracts` (`packages/contracts`) `[Confirmado]`
- **Implementation Status**: Partial / Transition `[Confirmado]`
- **Main Entrypoints**:
  - `packages/contracts/src/index.ts` `[Confirmado]`
  - `packages/contracts/src/contract-bundle.ts` (lines 1-92) `[Confirmado]`
  - `packages/contracts/src/task-contract.ts` `[Confirmado]`
  - `packages/contracts/src/scope-contract.ts` `[Confirmado]`
  - `packages/contracts/src/seam-contract.ts` `[Confirmado]`
  - `packages/contracts/src/artifact-contract.ts` `[Confirmado]`
  - `packages/contracts/src/validation-contract.ts` `[Confirmado]`
  - `packages/contracts/src/legacy-adapter.ts` `[Confirmado]`
- **Public API Exports**: `TaskContractBundleSchema`, `TaskContractSchema`, `ScopeContractSchema`, `SeamContractSchema`, `ArtifactContractSchema`, `ValidationContractSchema`, `ContractReferenceSchema`, `AgentTaskContractSchema`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/shared`. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**:
  - Legacy `AgentTaskContractSchema` remains exported and used in legacy decomposer and runner paths alongside target V2 `TaskContractBundleSchema` (`packages/contracts/src/legacy-adapter.ts`: line 1) (`Confirmado`).

### 3.5 `packages/decomposer`
- **Name & Path**: `@manyhands/decomposer` (`packages/decomposer`) `[Confirmado]`
- **Implementation Status**: Partial / Transition `[Confirmado]`
- **Main Entrypoints**:
  - `packages/decomposer/src/index.ts` (lines 1-1564) `[Confirmado]`
  - `packages/decomposer/src/compiler/graph-compiler.ts` `[Confirmado]`
  - `packages/decomposer/src/compiler/contract-compiler.ts` `[Confirmado]`
  - `packages/decomposer/src/planner/work-breakdown.ts` `[Confirmado]`
- **Public API Exports**: `FeatureRequestSchema`, `DecompositionOptionsSchema`, `DecompositionResult`, `Decomposer`, `LLMDecomposer`, `DeterministicDecomposer`, `WorkBreakdownPlanner`, `compileGraphRevision`, `compileContractBundles`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/contracts`, `@manyhands/repository-index`, `@manyhands/shared`, `@manyhands/task-graph`. `[Confirmado]`
  - *External npm*: `@anthropic-ai/sdk`, `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**:
  - `DecompositionResult` primary interface returns legacy `TaskGraph` & `AgentTaskContract[]` (`packages/decomposer/src/index.ts`: lines 83-89), while V2 `GraphCompiler` (`packages/decomposer/src/compiler/graph-compiler.ts`) is secondary (`Confirmado`).

### 3.6 `packages/execution-core`
- **Name & Path**: `@manyhands/execution-core` (`packages/execution-core`) `[Confirmado]`
- **Implementation Status**: Partial / Transition `[Confirmado]`
- **Main Entrypoints**:
  - `packages/execution-core/src/index.ts` (lines 1-59) `[Confirmado]`
  - `packages/execution-core/src/v2/exact-candidate-validator.ts` `[Confirmado]`
  - `packages/execution-core/src/v2/node-executor.ts` `[Confirmado]`
  - `packages/execution-core/src/worktree/manager.ts` `[Confirmado]`
  - `packages/execution-core/src/base/execution-base-builder.ts` `[Confirmado]`
- **Public API Exports**: `WorktreeManager`, `ExecutionBaseBuilder`, `CandidateValidator`, `ExactCandidateValidator`, `NodeExecutor`, `CLIExecutor`, `ProcessInspector`, `EvidenceMatrix`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/repository-index`, `@manyhands/scheduler`, `@manyhands/shared`, `@manyhands/task-graph`, `@manyhands/trace-store`. `[Confirmado]`
  - *External npm*: `simple-git`, `typescript`, `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**:
  - Coexistence of legacy task execution pipeline (`packages/execution-core/src/run/executor.ts`) with target V2 Exact Candidate Validator (`packages/execution-core/src/v2/exact-candidate-validator.ts`) and Node Executor (`packages/execution-core/src/v2/node-executor.ts`) (`Confirmado`).

### 3.7 `packages/orchestrator-graph`
- **Name & Path**: `@manyhands/orchestrator-graph` (`packages/orchestrator-graph`) `[Confirmado]`
- **Implementation Status**: Partial / Transition `[Confirmado]`
- **Main Entrypoints**:
  - `packages/orchestrator-graph/src/index.ts` (lines 1-12) `[Confirmado]`
  - `packages/orchestrator-graph/src/v2/execution-driver.ts` `[Confirmado]`
- **Public API Exports**: `V2ExecutionDriver`, `V2ExecutionDriverOptions`, `V2ExecutionRunInput`, `V2NodeExecutionOutcome`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/contracts`, `@manyhands/conflict-risk`, `@manyhands/run-coordinator`, `@manyhands/scheduler`, `@manyhands/task-graph`. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**:
  - `V2ExecutionDriver` drives graph execution over `RunCoordinator` facts (`packages/orchestrator-graph/src/v2/execution-driver.ts`: line 1). Target spec `docs/system/09-composer.md` requires orchestrator-graph to strictly delegate state facts to `RunCoordinator` without local state duplication (`Confirmado`).

### 3.8 `packages/run-coordinator`
- **Name & Path**: `@manyhands/run-coordinator` (`packages/run-coordinator`) `[Confirmado]`
- **Implementation Status**: Complete / Core Target Architecture `[Confirmado]`
- **Main Entrypoints**:
  - `packages/run-coordinator/src/index.ts` (lines 1-18) `[Confirmado]`
  - `packages/run-coordinator/src/coordinator.ts` `[Confirmado]`
  - `packages/run-coordinator/src/reducer.ts` (lines 1-600) `[Confirmado]`
- **Public API Exports**: `RunCoordinator`, `runCoordinatorReducer`, `RunDomainEventSchema`, `RunLifecycleState`, `InputFingerprint`, `HumanDecision`, `EvidenceMatrix`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/shared`, `@manyhands/task-graph`. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**: None. Fully implements canonical domain event reducer & state machine per target architecture specs (`docs/system/04-run-executor.md`, `docs/DECISIONS.md`) (`Confirmado`).

### 3.9 `packages/run-store`
- **Name & Path**: `@manyhands/run-store` (`packages/run-store`) `[Confirmado]`
- **Implementation Status**: Complete `[Confirmado]`
- **Main Entrypoints**:
  - `packages/run-store/src/index.ts` (lines 1-8) `[Confirmado]`
  - `packages/run-store/src/jsonl-event-store.ts` `[Confirmado]`
  - `packages/run-store/src/snapshot-store.ts` `[Confirmado]`
  - `packages/run-store/src/artifact-store.ts` `[Confirmado]`
  - `packages/run-store/src/attempt-store.ts` `[Confirmado]`
- **Public API Exports**: `EventStore`, `JsonlEventStore`, `ArtifactStore`, `AttemptStore`, `SnapshotStore`, `EventUpcaster`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/run-coordinator`, `@manyhands/shared`. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**: None. Implements canonical JSONL event stream persistence (`Confirmado`).

### 3.10 `packages/trace-store`
- **Name & Path**: `@manyhands/trace-store` (`packages/trace-store`) `[Confirmado]`
- **Implementation Status**: Complete `[Confirmado]`
- **Main Entrypoints**:
  - `packages/trace-store/src/index.ts` (lines 1-143) `[Confirmado]`
- **Public API Exports**: `TraceStore`, `InMemoryTraceStore`, `TraceEventSchema`, `TraceEventTypeSchema`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/shared`. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**: None. Implements diagnostic telemetry store separate from domain state events (`Confirmado`).

### 3.11 `packages/repository-index`
- **Name & Path**: `@manyhands/repository-index` (`packages/repository-index`) `[Confirmado]`
- **Implementation Status**: Complete `[Confirmado]`
- **Main Entrypoints**:
  - `packages/repository-index/src/index.ts` `[Confirmado]`
  - `packages/repository-index/src/snapshot.ts` (lines 1-196) `[Confirmado]`
  - `packages/repository-index/src/capabilities.ts` `[Confirmado]`
- **Public API Exports**: `RepositoryIndexer`, `buildRepositorySnapshotRecord`, `createRepositorySnapshotSchema`, `discoverRepositoryCapabilities`, `RepositorySnapshotRecord`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/shared`. `[Confirmado]`
  - *External npm*: `typescript`, `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**: None. Aligns with `docs/system/14-repository-index.md` (`Confirmado`).

### 3.12 `packages/scheduler`
- **Name & Path**: `@manyhands/scheduler` (`packages/scheduler`) `[Confirmado]`
- **Implementation Status**: Partial / Transition `[Confirmado]`
- **Main Entrypoints**:
  - `packages/scheduler/src/index.ts` (lines 1-900) `[Confirmado]`
  - `packages/scheduler/src/readiness-v2.ts` (lines 1-26) `[Confirmado]`
  - `packages/scheduler/src/wave-selector-v2.ts` `[Confirmado]`
- **Public API Exports**: `explainReadiness`, `selectReadyWaveV2`, `Scheduler`, `scheduleBatch`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/task-graph`. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**:
  - Coexistence of legacy task dependency batch scheduler and V2 `explainReadiness` artifact calculator (`packages/scheduler/src/readiness-v2.ts`) (`Confirmado`).

### 3.13 `packages/conflict-risk`
- **Name & Path**: `@manyhands/conflict-risk` (`packages/conflict-risk`) `[Confirmado]`
- **Implementation Status**: Complete `[Confirmado]`
- **Main Entrypoints**:
  - `packages/conflict-risk/src/index.ts` (lines 1-895) `[Confirmado]`
  - `packages/conflict-risk/src/constraint-evidence.ts` `[Confirmado]`
- **Public API Exports**: `ConflictRiskAnalyzer`, `analyzeConflictRisk`, `ConflictEvidenceSchema`, `ConflictRiskScoreSchema`, `ConflictConstraintEvidenceSchema`. `[Confirmado]`
- **Dependencies**:
  - *Internal Workspace*: `@manyhands/contracts`, `@manyhands/repository-index`, `@manyhands/shared`. `[Confirmado]`
  - *External npm*: `zod`. `[Confirmado]`
- **Architectural Gaps & Deviations**: None. Aligns with `docs/system/13-conflict-risk.md` (`Confirmado`).

---

## 4. Structured Data Verification

The structured audit data mapping 100% of apps and packages has been saved to:
- `coverage-ledger.json` `[Confirmado]`
- `01-system-map.md` `[Confirmado]`

---

## 5. Summary & Verification

All 13 workspace units have been inspected, categorized, and cataloged. Build parameters, typechecks, and workspace manifests are verified.
