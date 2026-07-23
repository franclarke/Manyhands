# 12 — Scalability & Performance Assessment

**Audit Date**: 2026-07-21  
**Target Subsystems**: `packages/run-store`, `packages/execution-core`, `packages/conflict-risk`, `apps/web`  
**Auditor**: Teamwork Explorer (Scalability Specialist)  

---

## 1. Scalability Architecture Overview

ManyHands aims to orchestrate large software projects across dozens of parallel worker agents. However, performance profiling and static code analysis revealed critical algorithmic and I/O scalability bottlenecks that limit the system's ability to scale to high event counts or large repository graphs.

---

## 2. Performance Bottlenecks Inventory (`MH-AUDIT-GAP-xxx`)

| Issue ID | Severity | Bottleneck Category | Location | Algorithmic Complexity / Metric | Description |
|---|---|---|---|---|---|
| `MH-AUDIT-GAP-008` | **P1 (High)** | Event Store Write I/O | `packages/run-store/src/jsonl-event-store.ts:220` | $O(N^2)$ I/O re-write loop | `append()` reads the full historical event file, appends the new event in memory, and re-writes the entire file to disk on every event. |
| `MH-AUDIT-GAP-009` | **P1 (High)** | Git Worktree Disk Footprint | `packages/execution-core/src/worktree/manager.ts:140` | $3 \times S_{\text{repo}}$ per node attempt | Creating physical worktree clones without hardlinks or shared object pools consumes ~3x repo size per node execution. |
| `MH-AUDIT-GAP-010` | **P1 (High)** | Conflict Risk Matrix | `packages/conflict-risk/src/analyzer.ts:88-125` | $O(N^2 \cdot M)$ pairwise comparison | Pairwise file scope comparison recalculates risk scores across all graph nodes on every wave step. |
| `MH-AUDIT-GAP-011` | **P2 (Medium)** | Web UI Event Refolding | `apps/web/src/lib/client/use-live-run-model.ts:88` | $O(E^2)$ client re-render | `useLiveRunModel` refolds the complete event stream from event 0 on every incoming SSE event message. |
| `MH-AUDIT-GAP-012` | **P2 (Medium)** | Snapshot Deserialization | `packages/run-store/src/snapshot-store.ts:95` | $O(S)$ per query | `SnapshotStore` reads and parses full JSON snapshot blobs from disk on every readiness state check without an in-memory LRU cache. |

---

## 3. Bottleneck Deep Dive & Scaling Limits

### `MH-AUDIT-GAP-008`: $O(N^2)$ Event Store Append Re-Write Loop
- **Location**: `packages/run-store/src/jsonl-event-store.ts:220-245`
- **Analysis**: Instead of opening a append-only file handle (`fs.open(path, 'a')`) to append a single line, `append()` loads all existing events from disk, appends the new event object to the array, serializes the full array back to a JSON string, and calls `atomicWrite` to overwrite the file on disk.
- **Scaling Limit**: For a run emitting 5,000 events, appending event 5,000 writes a 15MB file. Total cumulative disk write I/O for 5,000 events equals $\sum_{k=1}^{5000} k \cdot 3 \text{ KB} \approx 37.5 \text{ GB}$ of written data. Disk write thrashing severely slows down execution driver loops.

---

## 4. Scalability Mitigation Roadmap

1. **Convert Event Store to True Append Stream (`MH-AUDIT-GAP-008`)**: Replace read-serialize-overwrite pattern in `JsonlRunEventStore.append()` with `fs.appendFile` or persistent append stream handles.
2. **Implement Client Incremental Event Reducer (`MH-AUDIT-GAP-011`)**: Update `useLiveRunModel` hook to apply incoming SSE events incrementally to the active state model rather than re-folding the entire event array.
3. **Add Snapshot LRU Memory Cache (`MH-AUDIT-GAP-012`)**: Wrap `RunSnapshotStore.get()` in a 50-item LRU memory cache to eliminate disk reads during graph wave calculation steps.
