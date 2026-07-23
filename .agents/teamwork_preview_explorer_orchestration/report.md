# Audit Report: Task Graph, Decomposer, Scheduler, and Orchestration Graph

**Auditor**: teamwork_preview_explorer (Orchestration & Task Graph Specialist)  
**Date**: 2026-07-21  
**Target Packages**:
- `packages/task-graph`
- `packages/decomposer`
- `packages/orchestrator-graph`
- `packages/scheduler`
- `packages/conflict-risk`
- `packages/contracts`

**Target Specs Referenced**:
- `docs/system/01-task-graph.md`
- `docs/system/02-contracts.md`
- `docs/system/03-decomposer.md`
- `docs/system/12-scheduler.md`
- `docs/system/13-conflict-risk.md`

---

## 1. Executive Summary

This audit evaluates the current V2 implementation of ManyHands' task graph, decomposer, scheduler, conflict risk, and orchestration graph engine against the target architectural specifications (`docs/system/01-task-graph.md` through `13-conflict-risk.md`).

While the codebase has made significant progress introducing canonical V2 domain types (`GraphRevision`, `TaskContractBundle`, `WaveSelection`, `ExecutionDriver`), critical invariants remain unvalidated or disconnected between packages. Most notably:
1. **DAG Cycle Validation**: `validateGraphRevision` only checks parent-child tree hierarchy cycles, completely failing to detect circular `ArtifactRequirement` dependencies.
2. **Conflict Constraint Disconnect**: Graph-level `ConflictConstraint` objects compiled into `GraphRevision` by the Graph Compiler are ignored by the V2 scheduler during wave selection.
3. **Concurrency & Race Conditions**: Parallel attempt persistence in `V2ExecutionDriver` relies on an unhandled promise chain without in-flight attempt cancellation on failure.
4. **Scope Isolation Critic Over-restriction**: The decomposer critic `reviewScopes` incorrectly rejects planned modifications to existing repository files.

A total of **10 issues** have been cataloged with exact line numbers, severity ratings (`MH-AUDIT-ORCH-001` through `MH-AUDIT-ORCH-010`), evidence chains, and recommended remediations.

---

## 2. Invariant & Architecture Audit

### 2.1 Task Graph Invariants (`docs/system/01-task-graph.md`)

| Invariant | Spec Requirement | Actual Code Implementation | Status / Finding |
|---|---|---|---|
| **Root Node Identity** | Exactly one root node without parentage (`rootId`). | Checked in `validate-v2.ts` lines 29–36. Root must be `root`/`composite` (or sole atomic `leaf`) with `parentId === null`. | ✅ PASS |
| **Hierarchy Reachability** | All nodes reachable by parentage from root. | Checked via `hierarchyCycleNodes` in `validate-v2.ts` lines 46 & 80–98. Missing full reachability check from `rootId` for disconnected sub-trees. | ⚠️ PARTIAL |
| **DAG Cycle Validation** | No cycles of `ArtifactRequirement`. | `hierarchyCycleNodes` only checks `parentId` links. `ArtifactRequirement` edge cycles are NOT checked. | ❌ FAIL (`MH-AUDIT-ORCH-001`) |
| **Relation Boundary** | Requirements and seams must cross node boundaries. | Enforced in `relations.ts` (lines 11–15 & 26–29) via Zod `.superRefine`. | ✅ PASS |
| **Revisions & CAS** | Graph revision is immutable; amendments produce incremented revision via CAS expected revision check. | Enforced in `reviseGraph` (`validate-v2.ts` lines 52–62). | ✅ PASS |
| **Composite Readiness** | Composite ready for integration when child artifacts are verified/fresh. | Checked in `readiness-v2.ts` (lines 7–13) via `requiredFor: "execution" \| "integration"`. | ✅ PASS |

### 2.2 Contracts & Scopes (`docs/system/02-contracts.md`)

| Requirement | Spec Target | Actual Code Implementation | Status / Finding |
|---|---|---|---|
| **Contract Bundling** | `TaskContractBundle` combines Task, Scope, Seam, Artifact, and Validation contracts. | Implemented in `contract-bundle.ts` (`TaskContractBundleSchema`). | ✅ PASS |
| **Scope Safety** | Safe repo-relative paths; forbidden paths win; path traversal (`..`) rejected. | Enforced in `contract-identity.ts` lines 25–40 (`unsafeRepoRelativePathReason`). | ✅ PASS |
| **Validation Obligation Grounding** | Obligations frozen by ValidationContract; every required criterion must have an obligation. | Enforced in `contract-bundle.ts` lines 64–68. | ✅ PASS |
| **Command Safety** | Validation commands use structured argv binary names, rejecting shell entrypoints and metacharacters. | Enforced in `contracts/src/index.ts` lines 142–170 (`validationCommandSafetyIssues`). | ✅ PASS |

### 2.3 Decomposer & Graph Compiler (`docs/system/03-decomposer.md`)

| Stage | Spec Target | Actual Code Implementation | Status / Finding |
|---|---|---|---|
| **Pipeline** | Breakdown -> Graph Compiler -> GraphRevision + Bundles -> Critics. | Implemented in `decomposer/src/compiler/graph-compiler.ts` (`compileGraphRevision`). | ✅ PASS |
| **Scope Conflict Compilation** | Overlapping leaf scopes compile to `ConflictConstraint` with `risk: "high"`. | Implemented in `graph-compiler.ts` lines 157–179 (`compileScopeConflicts`). | ⚠️ PARTIAL (`MH-AUDIT-ORCH-002`) |
| **Critics Review** | Review 7 critics (completeness, atomicity, contract compatibility, DAG, scope, risk, validation). | Implemented in `decomposer/src/critics/review.ts` (`reviewCompiledPlan`). | ⚠️ PARTIAL (`MH-AUDIT-ORCH-004`) |

### 2.4 Scheduler & Concurrency (`docs/system/12-scheduler.md`, `13-conflict-risk.md`)

| Feature | Spec Target | Actual Code Implementation | Status / Finding |
|---|---|---|---|
| **Readiness Rules** | Leaf ready when: approved revision, not paused/cancelled, required artifacts adopted, materializable base, no active conflict constraint, budget available. | Implemented in `scheduler/src/readiness-v2.ts` (`explainReadiness`). | ✅ PASS |
| **Wave Selection** | Wave selection maximizes useful work under `maxParallel` budget and conflict constraints; output durable wave selection. | Implemented in `wave-selector-v2.ts` (`selectReadyWaveV2`) and `execution-driver.ts` line 145. | ⚠️ PARTIAL (`MH-AUDIT-ORCH-002`) |
| **Parallel Execution Driver** | Persists wave and attempt-start before invocation; records candidate, evidence, and artifact adoption deterministically. | Implemented in `orchestrator-graph/src/v2/execution-driver.ts` (`V2ExecutionDriver`). | ⚠️ PARTIAL (`MH-AUDIT-ORCH-003`) |

---

## 3. Cataloged Issues & Findings (`MH-AUDIT-ORCH-xxx`)

### MH-AUDIT-ORCH-001 (Severity: HIGH)
- **Component**: `packages/task-graph`
- **File & Lines**: `packages/task-graph/src/validate-v2.ts`, lines 24–50 & 80–98
- **Title**: `validateGraphRevision` misses `ArtifactRequirement` DAG cycle validation
- **Observation**:
  `validateGraphRevision` calls `hierarchyCycleNodes(graph)` (lines 46 & 80–98), which only traverses `node.parentId` references. It never validates that `graph.artifactRequirements` forms an acyclic directed graph (DAG).
- **Logic Chain**:
  1. Spec `01-task-graph.md` line 85 states: "Un graph revision es ejecutable solo si: no hay ciclos de ArtifactRequirement".
  2. If Node A produces artifact `art-A` consumed by Node B for execution, and Node B produces artifact `art-B` consumed by Node A for execution, `graph.artifactRequirements` contains a cycle.
  3. `validateGraphRevision` passes this graph as valid because `hierarchyCycleNodes` only inspects parentage.
  4. At runtime, the scheduler (`explainReadiness`) blocks both Node A and Node B indefinitely, causing an undetected run deadlock.
- **Remediation**: Add a DAG cycle check for `artifactRequirements` in `validateGraphRevision` using Topological Sort / Kahn's algorithm or DFS cycle detection.

---

### MH-AUDIT-ORCH-002 (Severity: HIGH)
- **Component**: `packages/scheduler` & `packages/orchestrator-graph`
- **File & Lines**: `packages/scheduler/src/wave-selector-v2.ts`, lines 6–19; `packages/orchestrator-graph/src/v2/execution-driver.ts`, lines 126–132
- **Title**: Compiled `GraphRevision.conflictConstraints` are ignored during wave selection
- **Observation**:
  `compileScopeConflicts` in `graph-compiler.ts` (lines 157–179) populates `graph.conflictConstraints`. However, `selectReadyWaveV2` accepts `conflictConstraints: ConflictConstraintEvidence[]` (from `@manyhands/conflict-risk`) and does not read `input.graph.conflictConstraints`. `V2ExecutionDriver.advance` passes `input.conflictConstraints` from `V2ExecutionRunInput`.
- **Logic Chain**:
  1. Graph Compiler detects scope overlaps between non-ancestor nodes and compiles `ConflictConstraint` records into `GraphRevision`.
  2. `V2ExecutionDriver` invokes `selectReadyWaveV2` passing `input.conflictConstraints` (external input), omitting `input.graph.conflictConstraints`.
  3. `selectReadyWaveV2` evaluates conflicts using `blocksPair` against `input.conflictConstraints`. `graph.conflictConstraints` are never checked.
  4. Overlapping nodes that were constrained by the Graph Compiler are scheduled concurrently in the same wave, causing file write collisions in agent worktrees during execution.
- **Remediation**: Update `selectReadyWaveV2` (or `V2ExecutionDriver.advance`) to convert and merge `input.graph.conflictConstraints` into the active conflict constraints array before wave selection.

---

### MH-AUDIT-ORCH-003 (Severity: HIGH)
- **Component**: `packages/orchestrator-graph`
- **File & Lines**: `packages/orchestrator-graph/src/v2/execution-driver.ts`, lines 159–169
- **Title**: Unhandled promise rejection chain & lack of in-flight attempt cancellation in parallel execution driver
- **Observation**:
  ```ts
  let recording = Promise.resolve();
  let latestState = state;
  await Promise.all(attempts.map(async (attempt) => {
    const outcome = await this.options.execute(attempt.executionInput);
    const facts = this.factsForOutcome(input, attempt, outcome);
    const persisted = recording.then(async () => {
      latestState = await this.options.coordinator.record(input.runId, facts);
    });
    recording = persisted;
    await persisted;
  }));
  ```
- **Logic Chain**:
  1. `recording` is mutated concurrently inside `Promise.all` callbacks.
  2. If `coordinator.record` throws an error for attempt 1, `persisted` rejects.
  3. When attempt 2 finishes, `recording.then(...)` executes on a rejected promise, causing attempt 2's `await persisted` to reject with an unhandled promise rejection error.
  4. Furthermore, if attempt 1 fails and raises a stopping decision, attempt 2 continues running in the background without cancellation because `V2ExecutionDriver` has no abort controller or cancellation signal.
- **Remediation**: Use a sequential mutex / queue for `coordinator.record` calls that safely handles errors without corrupting the promise chain, and introduce an `AbortSignal` to cancel in-flight executions when a fatal failure occurs.

---

### MH-AUDIT-ORCH-004 (Severity: MEDIUM)
- **Component**: `packages/decomposer`
- **File & Lines**: `packages/decomposer/src/critics/review.ts`, lines 100–102
- **Title**: `reviewScopes` critic incorrectly flags planned modifications to existing repository files as errors
- **Observation**:
  ```ts
  for (const path of plannedPaths) {
    if (indexedPaths.has(path)) {
      findings.push(finding("scope_isolation", "error", "planned_path_already_exists", `Planned path ${path} already exists in the repository snapshot.`, "Cite the existing path as repository evidence instead of declaring it as a new output.", []));
    }
  }
  ```
- **Logic Chain**:
  1. `plannedPaths` represents paths intended to be created or modified by a work unit.
  2. If a breakdown task plans to modify an existing file (e.g. `src/index.ts`) and lists it in `plannedPaths`, `reviewScopes` emits an `"error"` severity finding `planned_path_already_exists`.
  3. `assertPlanReview` throws an exception for any error-level finding, rejecting the entire plan compilation.
  4. Valid feature additions or bugfixes that edit pre-existing files become unapprovable if listed in `plannedPaths`.
- **Remediation**: Change `planned_path_already_exists` severity from `"error"` to `"warning"`, or distinguish between `new_files` and `modified_files` in work breakdown planning.

---

### MH-AUDIT-ORCH-005 (Severity: MEDIUM)
- **Component**: `packages/orchestrator-graph`
- **File & Lines**: `packages/orchestrator-graph/src/v2/execution-driver.ts`, lines 250–270
- **Title**: Inconsistent event sequence when evidence matrix validation outcome is unverified
- **Observation**:
  When `outcome.evidenceMatrix.outcome !== "verified"` (lines 266–269), `factsForOutcome` emits `attempt.candidate_created` and `validation.completed`, followed by a `decision.raised` fact. However, it does not emit an `attempt.failed` fact or mark the node as invalidated.
- **Logic Chain**:
  1. An execution attempt completes with `outcome.kind === "success"`, but static/unit validation fails (`evidenceMatrix.outcome === "failed"`).
  2. `factsForOutcome` records `attempt.candidate_created` and `validation.completed`, and then raises a decision `decision.raised`.
  3. No `attempt.failed` or `candidate.invalidated` event is recorded.
  4. On the next wave evaluation, `buildReadinessState` checks `adoptedArtifacts`. Because the candidate was unverified, no artifact was adopted. The node remains stuck in unadopted state with a pending decision, but the failure classification policy (`recoveryPolicyFor`) is never recorded for the validation failure.
- **Remediation**: Record explicit failure classification (`failure.classified`) and `attempt.failed` events when `evidenceMatrix.outcome !== "verified"` before raising a decision.

---

### MH-AUDIT-ORCH-006 (Severity: MEDIUM)
- **Component**: `packages/task-graph`
- **File & Lines**: `packages/task-graph/src/validate-v2.ts`, lines 100–117
- **Title**: `validateGraphRevision` skips contract & revision resolution checks
- **Observation**:
  Spec `01-task-graph.md` lines 86–89 requires checking that "producers y consumers existen; revisions y contratos referenciados existen; todo leaf tiene contrato ejecutable; todo composite tiene criterios de integración". `validateGraphRevision` only checks node ID existence in `graph.nodes`.
- **Logic Chain**:
  1. A `GraphRevision` can reference non-existent contract IDs in `artifactRequirements` or `seamBindings`.
  2. `validateGraphRevision` passes because it only validates that `producerNodeId` and `consumerNodeId` exist in `graph.nodes`.
  3. Contract resolution errors are deferred until contract bundle compilation or runtime wave execution.
- **Remediation**: Extend `validateGraphRevision` (or add `validateGraphRevisionContracts`) to accept an optional contract registry and verify referenced contract IDs/revisions.

---

### MH-AUDIT-ORCH-007 (Severity: MEDIUM)
- **Component**: `packages/task-graph`
- **File & Lines**: `packages/task-graph/src/validate-v2.ts`, lines 129–135
- **Title**: `reviseGraph` operation application permits duplicate relation pushes prior to validation
- **Observation**:
  In `applyOperation`, operations such as `add_artifact_requirement` directly call `graph.artifactRequirements.push(structuredClone(operation.requirement))`.
- **Logic Chain**:
  1. If a caller issues two identical `add_artifact_requirement` operations in one `reviseGraph` call, both are pushed onto `graph.artifactRequirements`.
  2. Post-validation `validateUniqueIds` catches the duplicate ID and throws a generic `Graph revision is invalid` error.
  3. The error message does not indicate which operation caused the duplicate ID.
- **Remediation**: Check for duplicate relation IDs directly in `applyOperation` before pushing new relations.

---

### MH-AUDIT-ORCH-008 (Severity: MEDIUM)
- **Component**: `packages/conflict-risk` & `packages/task-graph`
- **File & Lines**: `packages/conflict-risk/src/constraint-evidence.ts`, lines 1–6; `packages/task-graph/src/relations.ts`, lines 37–47; `docs/system/13-conflict-risk.md`
- **Title**: Severity and risk level classification divergence across conflict risk and task graph packages
- **Observation**:
  `ConflictConstraintSchema` in `task-graph` defines `risk: z.enum(["low", "medium", "high"])`. `ConflictConstraintEvidence` in `conflict-risk` defines `risk: "unknown" | "low" | "medium" | "high" | "blocking"`. Spec `13-conflict-risk.md` specifies outputs as `advisory | serialize | resource_lock | compiler_finding`.
- **Logic Chain**:
  1. Three different representations of conflict risk exist across the codebase and specs.
  2. Converting a `ConflictConstraintEvidence` with risk `"blocking"` or `"unknown"` into a `GraphRevision.conflictConstraints` record causes a Zod validation error because `ConflictConstraintSchema` rejects `"blocking"` and `"unknown"`.
  3. Mappings between packages require manual lossy transformations.
- **Remediation**: Harmonize the risk level enum across `task-graph`, `conflict-risk`, and target documentation specs.

---

### MH-AUDIT-ORCH-009 (Severity: LOW)
- **Component**: `packages/scheduler`
- **File & Lines**: `packages/scheduler/src/readiness-v2.ts`, lines 14–17
- **Title**: Optional `requiredContractRevisions` property skips contract staleness evaluation
- **Observation**:
  In `explainReadiness`, contract staleness is checked via `input.requiredContractRevisions?.[input.nodeId] ?? []`.
- **Logic Chain**:
  1. If `ReadinessStateV2` is constructed without `requiredContractRevisions`, the nullish coalescing operator yields `[]`.
  2. The loop over required contracts does not execute.
  3. Nodes with stale contract revisions are reported as ready without detecting contract staleness.
- **Remediation**: Make `requiredContractRevisions` a required field in `ReadinessStateV2` or default it from the graph contracts.

---

### MH-AUDIT-ORCH-010 (Severity: LOW)
- **Component**: `packages/task-graph` & `packages/contracts`
- **File & Lines**: `packages/task-graph/src/index.ts` vs `graph-revision.ts`; `packages/contracts/src/index.ts` vs `contract-bundle.ts`
- **Title**: Coexistence of un-unified V1 legacy and V2 target graph/contract domain types
- **Observation**:
  `@manyhands/task-graph` exports both legacy `TaskGraph` (with string status fields and flat `dependencies`) and V2 `GraphRevision` (with typed relations and revisions). `@manyhands/contracts` exports legacy `AgentTaskContract` and V2 `TaskContractBundle`.
- **Logic Chain**:
  1. Adapters (`adaptTaskGraphV1ToV2`, `adaptParsedLegacyAgentTaskContract`) bridge V1 and V2 models.
  2. Because V1 and V2 use overlapping field names with different semantics (e.g. `dependencies`), consumers can accidentally pass V1 instances to V2 utility functions or vice versa.
  3. No compile-time brand or explicit deprecation warning distinguishes V1 models from V2 target models.
- **Remediation**: Mark V1 models with `@deprecated` JSDoc annotations and enforce strict type guards between V1 and V2 domain types.

---

## 4. Summary of Verification & Next Steps

To verify these findings independently:
1. **Verify MH-AUDIT-ORCH-001**: Construct a `GraphRevision` with a cycle in `artifactRequirements` (A -> B -> A). Run `validateGraphRevision(graph)`. Observe that it returns 0 issues.
2. **Verify MH-AUDIT-ORCH-002**: Compile a breakdown with scope overlap between leaves. Inspect `graph.conflictConstraints`. Pass the compiled graph to `selectReadyWaveV2` without passing external `conflictConstraints`. Observe both leaves are selected in the same wave.
3. **Verify MH-AUDIT-ORCH-004**: Add an existing repository file path to a `WorkUnit`'s `plannedPaths`. Run `reviewCompiledPlan`. Observe that `reviewScopes` adds an error-level finding `planned_path_already_exists`.

**Verification Command**:
```bash
pnpm test
pnpm --filter @manyhands/task-graph test
pnpm --filter @manyhands/decomposer test
pnpm --filter @manyhands/scheduler test
```
