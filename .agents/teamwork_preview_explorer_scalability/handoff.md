# Handoff Report — Scalability & Missing Systems Audit

**Agent**: `teamwork_preview_explorer` (Scalability & Missing Systems Specialist)  
**Date**: 2026-07-21  
**Working Directory**: `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_scalability`

---

## 1. Observation

1. **Event Store Persistence (`packages/run-store/src/jsonl-event-store.ts`)**:
   - Lines 118-119: `foldRun([...inspection.events, ...appended]); await writeDurableEvents(this.eventLogPath(runId), [...inspection.events, ...appended]);`
   - Line 237: `const contents = events.map((event) => JSON.stringify({ schemaVersion: CURRENT_EVENT_SCHEMA_VERSION, event, checksum: checksumFor(event) } satisfies DurableEventEnvelope)).join("\n");`
   - Line 257: `await writeFile(temporary, contents, "utf8"); await rename(temporary, filePath);`
   - Every event batch append re-reads the whole JSONL log, parses all lines, computes SHA-256 for all prior events, folds all events, and re-writes the entire file.

2. **Snapshot Management (`packages/run-store/src/snapshot-store.ts`)**:
   - Lines 48-56: `const events = await this.events.load(runId); ... const projection = foldRun(events);`
   - Snapshots do not support incremental event folding or log compaction/truncation.

3. **Trace Store (`packages/trace-store/src/index.ts`)**:
   - Lines 101-142: `InMemoryTraceStore` holds all trace events in `private readonly events: TraceEvent[] = []`. No file system or persistent storage backend is implemented.

4. **Task Graph Validation (`packages/task-graph/src/validate-v2.ts`)**:
   - Lines 46, 80-98: `hierarchyCycleNodes(graph)` checks for cycles along `node.parentId` pointers only. `validateGraphRevision` contains zero checks for cycles in `graph.artifactRequirements`.

5. **Repository Indexer (`packages/repository-index/src/index.ts`)**:
   - Line 168: `const INDEXABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);`
   - Uses TypeScript AST parser (`ts.createSourceFile`) only. Non-JS/TS files are assigned `unknown` kind or skipped.

6. **Candidate Validator & Sandboxing (`packages/execution-core/src/v2/exact-candidate-validator.ts`)**:
   - Lines 46-50 & 69-73: Creates candidate worktree sandbox (`${input.runId}-${input.attemptId}-candidate`) AND baseline worktree sandbox (`${input.runId}-${input.attemptId}-baseline`). Combined with the execution worktree, 3 physical git worktrees are created per leaf attempt.

7. **Conflict Risk Matrix Scorer (`packages/conflict-risk/src/index.ts`)**:
   - Lines 142-151: `buildTaskPairRiskMatrix` loops through all $N(N-1)/2$ task pairs with unindexed string overlap logic (`intersectValues`, `findOverlappingPathPatterns`).

8. **Web SSE Stream Reducer (`apps/web/src/components/run-model/use-live-run-model.ts`)**:
   - Line 90: `const current = useMemo(() => buildLiveRunModel(streamEvents, seed, initialEvents), [initialEvents, seed, streamEvents]);`
   - Re-evaluates `buildRunModel` over all historical events starting from sequence 1 on every incoming SSE event packet.

---

## 2. Logic Chain

1. **Observation 1 & 2 $\rightarrow$ Conclusion on Event Store Bottlenecks**:
   - Because `JsonlRunEventStore.appendFenced` re-reads and re-writes the entire file on every append, writing $N$ events requires $\frac{N(N+1)}{2}$ line writes.
   - For $N = 2,000$, over 2,000,000 JSON lines and SHA-256 hashes are processed. This creates a quadratic $O(N^2)$ disk write I/O bottleneck (`MH-AUDIT-GAP-008`).
   - The lack of log compaction or truncation means event log size grows indefinitely (`MH-AUDIT-GAP-001`).

2. **Observation 3 $\rightarrow$ Conclusion on Telemetry Persistence**:
   - `InMemoryTraceStore` stores diagnostic events in an unbounded array in heap memory.
   - Traces are lost upon process termination and can consume unbounded memory during long runs (`MH-AUDIT-GAP-002`).

3. **Observation 4 $\rightarrow$ Conclusion on Graph Validation Gaps**:
   - `validateGraphRevision` only checks hierarchy cycles along `parentId` pointers.
   - Circular dependencies in `ArtifactRequirement` (Node A $\rightarrow$ Node B $\rightarrow$ Node A) bypass validation and cause scheduler stalls (`MH-AUDIT-GAP-003`).

4. **Observation 5 $\rightarrow$ Conclusion on Repository Indexing**:
   - The structural indexer only supports TS/JS/JSON files via TypeScript's compiler API.
   - Monorepos containing Python, Go, Rust, or Java lack symbol and import dependency analysis (`MH-AUDIT-GAP-004`).

5. **Observation 6 $\rightarrow$ Conclusion on Worktree I/O Overhead**:
   - Validating a single candidate spawns up to 3 physical git worktrees.
   - Under parallel execution (`maxParallel = 10`), 30 concurrent worktrees are created. On Windows OS, NTFS disk operations slow down significantly, leading to file locking errors (`MH-AUDIT-GAP-009`).

6. **Observation 7 $\rightarrow$ Conclusion on Conflict Risk Scalability**:
   - `buildTaskPairRiskMatrix` evaluates $O(N^2)$ pairs.
   - For graphs with 500+ nodes, computing 124,750 pair comparisons on every scheduling cycle causes CPU stalls (`MH-AUDIT-GAP-010`).

7. **Observation 8 $\rightarrow$ Conclusion on Web UI Rendering Bottleneck**:
   - On every incoming SSE event, `useLiveRunModel` calls `buildRunModel`, which executes `foldRun` over the full event list starting at sequence 1.
   - As events accumulate, client-side re-rendering freezes the browser UI DOM thread (`MH-AUDIT-GAP-011`).

---

## 3. Caveats

- **No Code Modifications**: This investigation was strictly read-only per agent instructions. No code implementation or refactoring was applied outside the `.agents/` working directory.
- **Environment Context**: NTFS file locking behavior (`EPERM`/`EBUSY`) was evaluated based on Windows OS characteristics where the project is running.
- **Benchmark Measurements**: Bottlenecks were identified via algorithmic and architectural code inspection ($O(N^2)$ loops, I/O patterns, object allocations). Benchmark profiling scripts were not executed.

---

## 4. Conclusion

ManyHands target specifications (`docs/system/`, `docs/DECISIONS.md`) describe an event-sourced, contract-driven, risk-aware multi-agent architecture. However, the current codebase implementation contains **7 missing architectural gaps/transition gaps** (`MH-AUDIT-GAP-001` through `MH-AUDIT-GAP-007`) and **5 major scalability/performance bottlenecks** (`MH-AUDIT-GAP-008` through `MH-AUDIT-GAP-012`).

The most urgent issues requiring remediation prior to scaling to large codebases are:
1. **`MH-AUDIT-GAP-008`**: Replacing full-file JSONL rewrites with true append streams.
2. **`MH-AUDIT-GAP-009`**: Reducing worktree duplication during candidate validation.
3. **`MH-AUDIT-GAP-011`**: Implementing incremental state reduction in the web UI.

---

## 5. Verification Method

To independently verify these findings:

1. **Verify Event Store Rewrite Behavior (`MH-AUDIT-GAP-008`)**:
   - Inspect `packages/run-store/src/jsonl-event-store.ts` at line 119 and line 237 (`writeDurableEvents`).
   - Run `pnpm test -- tests/jsonl-event-store.test.ts` while logging file write calls. Observe that `writeFile` is invoked with the full list of accumulated events on every append call.

2. **Verify Missing ArtifactRequirement Cycle Validation (`MH-AUDIT-GAP-003`)**:
   - Inspect `packages/task-graph/src/validate-v2.ts` lines 80-98. Confirm that `hierarchyCycleNodes` checks `parentId` links only.
   - Construct a `GraphRevision` with `artifactRequirements: [{ consumerNodeId: "A", producerNodeId: "B" }, { consumerNodeId: "B", producerNodeId: "A" }]` and pass it to `validateGraphRevision`. Observe that no cycle issue is returned.

3. **Verify Triple Worktree Allocation (`MH-AUDIT-GAP-009`)**:
   - Inspect `packages/execution-core/src/v2/exact-candidate-validator.ts` lines 46-50 & 69-73. Confirm creation of both `${runId}-${attemptId}-candidate` and `${runId}-${attemptId}-baseline` worktrees via `GitCandidateSandboxFactory`.

4. **Verify Risk Matrix $O(N^2)$ Pairwise Evaluation (`MH-AUDIT-GAP-010`)**:
   - Inspect `packages/conflict-risk/src/index.ts` lines 142-151 (`buildTaskPairRiskMatrix`). Confirm nested double `for` loop over all contract pairs.

5. **Verify Full Web Reducer Re-Execution (`MH-AUDIT-GAP-011`)**:
   - Inspect `apps/web/src/components/run-model/use-live-run-model.ts` line 90 (`buildLiveRunModel`). Confirm `buildRunModel` is called with `events` starting from sequence 1 on every state update.
