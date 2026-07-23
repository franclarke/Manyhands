# ManyHands Scalability, Bottlenecks & Missing Systems Audit Report

**Auditor**: `teamwork_preview_explorer` (Scalability & Missing Systems Specialist)  
**Date**: 2026-07-21  
**Scope**: Architecture audit comparing target specifications (`docs/system/`, `docs/DECISIONS.md`, `PRODUCT.md`) against current codebase implementations (`packages/*`, `apps/web`), examining scalability limits, performance bottlenecks, and unbuilt systems.

---

## 1. Executive Summary

While ManyHands has established a clean framework-independent domain model (V2 transition closed for core interfaces), a deep technical audit of the codebase reveals critical **scalability limits**, **performance bottlenecks**, and **unbuilt architectural subsystems**.

### Key Audit Findings Summary
- **Event Store $O(N^2)$ I/O Bottleneck**: `JsonlRunEventStore` re-reads, SHA-256 hashes, folds, and re-writes the entire JSONL event file on **every single event append**, leading to quadratic disk write I/O as the run event stream grows.
- **Missing Event Store Compaction**: No log compaction, segment splitting, or log truncation mechanism exists to prune historical events.
- **Triple Worktree Disk & File System Overhead**: Each node attempt materializes up to **3 physical Git worktrees** (execution worktree + candidate validation sandbox + baseline validation sandbox). Under parallel execution, disk footprint and NTFS file locking overhead cause severe Windows I/O contention.
- **$O(N^2)$ Pairwise Risk Matrix Calculation**: `buildTaskPairRiskMatrix` in `@manyhands/conflict-risk` evaluates all $N(N-1)/2$ task pairs with linear array scans, creating scheduling lag for graphs with hundreds of nodes.
- **Client-Side Full Reducer Re-Execution**: The Web UI (`useLiveRunModel`) re-folds the entire historical event stream from sequence 1 on **every incoming SSE event**, causing main-thread rendering freezes during high-frequency execution.
- **Missing Architecture Systems**: No persistent trace store, no `ArtifactRequirement` DAG cycle detection, no non-JS structural indexing, no negative-control validation, and no automated worktree/artifact GC.

---

## 2. Catalog of Missing Systems & Transition Gaps

| Gap ID | System / Component | Severity | Description | Target Spec Reference |
|---|---|---|---|---|
| **MH-AUDIT-GAP-001** | Event Store Compaction | **CRITICAL** | `JsonlRunEventStore` lacks event log compaction, log truncation, or segment pruning. | `docs/system/04-run-executor.md`, `docs/DECISIONS.md` (A12) |
| **MH-AUDIT-GAP-002** | Persistent Telemetry & Trace Store | **HIGH** | `InMemoryTraceStore` is purely in-memory; process logs and model traces lack persistent rotation/storage. | `docs/DECISIONS.md` (A12), `docs/system/04-run-executor.md` |
| **MH-AUDIT-GAP-003** | Artifact Requirement DAG Cycle Detection | **HIGH** | `validateGraphRevision` only validates parentage tree cycles, completely omitting `ArtifactRequirement` DAG cycle detection. | `docs/system/01-task-graph.md` (L85) |
| **MH-AUDIT-GAP-004** | Multi-Language Repository Indexing | **MEDIUM** | `TypeScriptRepositoryIndexer` only indexes TS/JS/JSON files via TypeScript AST parser; all other file types default to `unknown` without structural indexing. | `docs/system/14-repository-index.md` |
| **MH-AUDIT-GAP-005** | Incremental Snapshot Rebuilding | **MEDIUM** | `RunSnapshotStore.loadOrRebuild` loads ALL events from sequence 1 if snapshot is outdated, unable to fold incrementally from snapshot + delta events. | `docs/system/04-run-executor.md`, `11-artifact-registry.md` |
| **MH-AUDIT-GAP-006** | Artifact & Worktree Garbage Collection | **MEDIUM** | No automated background GC or storage pruning process exists for orphaned worktrees, builds, or stale artifact manifests. | `docs/system/11-artifact-registry.md` (L59) |
| **MH-AUDIT-GAP-007** | Negative Control Validation & AST Test Weakening Detection | **LOW** | Negative-control testing (verifying new tests fail on baseline commit) and AST-based detection of test weakening (`it.skip`, `it.only`, disabled assertions) are stubbed or unbuilt. | `docs/system/08-result-pipeline.md` (L34-35) |

---

## 3. Detailed Technical Analysis of Missing Systems

### MH-AUDIT-GAP-001: Missing Event Store Compaction & Segment Pruning
- **Observation**: In `packages/run-store/src/jsonl-event-store.ts`, the event log is maintained as a single file (`${runId}.events.v2.jsonl`). There is no log truncation, segment rotation, or compaction logic.
- **Impact**: Long-running runs with thousands of events produce megabyte-sized JSONL files that must be parsed from line 1 on every append, causing linear memory growth and quadratic disk I/O.
- **Target Spec**: `docs/system/04-run-executor.md` & `docs/DECISIONS.md` A12 specify that snapshots are discardable projections and the event log is the canonical history, but performance dictates event log segmentation or compaction behind snapshot checkpoints.

### MH-AUDIT-GAP-002: In-Memory Only Telemetry & Trace Store
- **Observation**: `packages/trace-store/src/index.ts` provides `InMemoryTraceStore`. `this.events.push(parsed)` stores all trace events in an unbounded JavaScript array in memory.
- **Impact**: Heavy agent executions with verbose process outputs and LLM telemetry cause unbounded memory consumption in node process memory. Traces disappear on process restart.
- **Target Spec**: `docs/DECISIONS.md` A12 mandates that model traces and process logs exist as separate telemetry that does not govern lifecycle, but should be durable on demand.

### MH-AUDIT-GAP-003: Omission of ArtifactRequirement Cycle Validation
- **Observation**: In `packages/task-graph/src/validate-v2.ts`, `validateGraphRevision` executes `hierarchyCycleNodes(graph)` which only checks for cycles along `parentId` pointers. No cycle validation is performed on `graph.artifactRequirements` (e.g., Node A requires artifact from Node B, which requires artifact from Node A).
- **Impact**: Circular artifact dependencies can be created and approved in a graph revision, causing the scheduler to hang indefinitely in `unmaterializable_base` without failing fast.
- **Target Spec**: `docs/system/01-task-graph.md` line 85 explicitly states: *"- no hay ciclos de ArtifactRequirement;"*.

### MH-AUDIT-GAP-004: Single-Language (TS/JS) Structural Repository Indexer
- **Observation**: `packages/repository-index/src/index.ts` uses `ts.createSourceFile` to parse TypeScript and JavaScript files. For any other language (Python, Go, Rust, Java, C#, etc.), files are either ignored or given `RepositoryFileKind = "unknown"` without symbol, export, or import indexing.
- **Impact**: Heterogeneous or multi-language monorepos cannot benefit from static conflict risk prediction, context packing, or seam discovery.
- **Target Spec**: `docs/system/14-repository-index.md` requires declaring language capabilities with low-confidence fallback text indexing for non-JS/TS languages.

---

## 4. Performance Bottlenecks & Scalability Limits

| Bottleneck ID | Affected Package | Severity | Description | Root Cause |
|---|---|---|---|---|
| **MH-AUDIT-GAP-008** | `run-store` | **CRITICAL** | $O(N^2)$ Event Write I/O | `appendFenced` re-reads full event log, re-calculates SHA-256 for all prior events, folds all events, and re-writes entire JSONL file on EVERY event batch append. |
| **MH-AUDIT-GAP-009** | `execution-core` | **HIGH** | $3\times$ Physical Git Worktree Overhead | Executing a leaf attempt materializes up to 3 physical git worktrees (attempt worktree + candidate validation sandbox + baseline sandbox), causing massive NTFS I/O slowdowns and `EPERM`/`EBUSY` locks on Windows. |
| **MH-AUDIT-GAP-010** | `conflict-risk` | **HIGH** | $O(N^2)$ Pairwise Risk Matrix Scans | `buildTaskPairRiskMatrix` evaluates $N(N-1)/2$ task pairs with un-indexed linear array comparisons on every scheduling cycle. |
| **MH-AUDIT-GAP-011** | `apps/web` | **HIGH** | Client Main-Thread Re-render Freeze | `useLiveRunModel` calls `buildRunModel` across all historical events from sequence 1 on every incoming SSE event, freezing the browser UI DOM for large streams. |
| **MH-AUDIT-GAP-012** | `task-graph` & `apps/web` | **MEDIUM** | $O(N^2)$ Graph Validation & Layout Allocation | `validateGraphRevision` executes `Object.values(graph.nodes)` inside node loops; `layoutRunTree` instantiates fresh `Set` objects on every recursive node step. |

---

## 5. Detailed Technical Analysis of Bottlenecks

### MH-AUDIT-GAP-008: Quadratic $O(N^2)$ Event Log Append & Rewrite
- **Code Reference**: `packages/run-store/src/jsonl-event-store.ts` (lines 91-122, 236-239)
```ts
// On EVERY appendFenced call:
const inspection = await this.inspect(runId); // Reads full file, parses JSON, computes SHA256 checksums
foldRun([...inspection.events, ...appended]); // Folds ALL events from start
await writeDurableEvents(this.eventLogPath(runId), [...inspection.events, ...appended]); // Re-writes ENTIRE file
```
- **Math/Impact**: For a run emitting $N$ events, total event lines written to disk = $\sum_{k=1}^N k = \frac{N(N+1)}{2} = O(N^2)$.
- For $N = 2,000$ events, ManyHands writes **2,001,000 JSON lines** to disk and computes SHA-256 checksums 2 million times. Disk I/O saturates rapidly.

### MH-AUDIT-GAP-009: Worktree Disk Multiplication under Parallel Execution
- **Code Reference**: `packages/execution-core/src/v2/exact-candidate-validator.ts` (lines 46-78), `packages/execution-core/src/git/runner.ts`
- **Mechanism**:
  1. `ExecutionBaseBuilder` calls `git worktree add` for attempt workspace.
  2. `ExactCandidateValidatorV2` creates candidate sandbox (`git worktree add` at `candidateCommit`).
  3. `ExactCandidateValidatorV2` creates baseline sandbox (`git worktree add` at `baselineCommit`).
- **Impact**: 3 full physical git checkouts per leaf node attempt. With `maxParallel = 10` on a 500 MB repo, active disk usage reaches $15\text{ GB}$. Windows OS NTFS file indexers and anti-virus lock files during `git worktree remove`, causing intermittent `EPERM` / `EBUSY` failures.

### MH-AUDIT-GAP-010: $O(N^2)$ Pairwise Risk Matrix Scans
- **Code Reference**: `packages/conflict-risk/src/index.ts` (lines 142-151)
```ts
for (let leftIndex = 0; leftIndex < contracts.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < contracts.length; rightIndex += 1) {
    predictions.push(predictConflict(left, right, staticSignals));
  }
}
```
- **Impact**: Evaluates $O(N^2)$ pairs. For 500 tasks in a graph, computes 124,750 pair comparisons. Each comparison performs multiple array intersections (`intersectValues`) across paths and symbols without spatial index lookup.

### MH-AUDIT-GAP-011: Main-Thread UI Event Stream Re-Folding
- **Code Reference**: `apps/web/src/components/run-model/use-live-run-model.ts` (lines 90-95)
```ts
const current = useMemo(() => buildLiveRunModel(streamEvents, seed, initialEvents), [initialEvents, seed, streamEvents]);
```
- **Impact**: When `streamEvents` updates, `buildRunModel` runs `foldRun` on the entire event array starting from `seq = 1`. In high-throughput execution (e.g. 50 events/sec), React re-renders freeze the user interface.

---

## 6. Recommendations & Mitigation Roadmap

1. **Fix Event Append I/O (MH-AUDIT-GAP-008 & 001)**:
   - Change `JsonlRunEventStore` to use a true append stream (`fs.appendFile`) instead of full file re-writes.
   - Implement log rotation / snapshot checkpointing so past events can be pruned or skipped during read operations.
2. **Optimize Worktree Sandboxes (MH-AUDIT-GAP-009)**:
   - Reuse existing worktrees for baseline validation instead of spawning fresh ones, or perform baseline checks in ephemeral clean directories without full Git worktree creation.
3. **Add ArtifactRequirement Cycle Detection (MH-AUDIT-GAP-003)**:
   - Implement Kahn's or Tarjan's algorithm in `validateGraphRevision` to detect cycles in `artifactRequirements` before graph revision approval.
4. **Index-Based Conflict Risk Scorer (MH-AUDIT-GAP-010)**:
   - Build a path-to-task and symbol-to-task inverted map to evaluate candidate conflicts in $O(K)$ time (where $K$ is actual overlap count) rather than $O(N^2)$ brute-force pair iteration.
5. **Incremental Client-Side Event Reduction (MH-AUDIT-GAP-011)**:
   - Update `useLiveRunModel` to incrementally fold incoming events into the existing `RunModel` state rather than re-folding the entire event history on every SSE chunk.

---

*Report authored by `teamwork_preview_explorer` (Scalability & Missing Systems Specialist).*
