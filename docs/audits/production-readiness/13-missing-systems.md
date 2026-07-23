# 13 — Missing Architecture Systems & Transition Gaps

**Audit Date**: 2026-07-21  
**Target Documents**: `PRODUCT.md`, `docs/system/`, `docs/DECISIONS.md`  
**Auditor**: Teamwork Explorer (Scalability & Missing Systems Specialist)  

---

## 1. Missing Architecture Systems Overview

Comparing the target architecture specifications (`docs/system/01-task-graph.md` through `13-conflict-risk.md`, `PRODUCT.md`) against the actual implementation in `packages/*` and `apps/web` revealed **7 missing subsystems and major transition gaps**.

These gaps represent target capabilities that are documented or required for production operation but remain unbuilt, stubbed, or partially implemented.

---

## 2. Inventory of Missing Subsystems (`MH-AUDIT-GAP-xxx`)

| Subsystem Name | Target Spec Reference | Implementation Status | Issue ID | Architectural Impact |
|---|---|---|---|---|
| **Event Store Compaction & Truncation** | `docs/system/06-persistence.md` §5 | Unbuilt | `MH-AUDIT-GAP-001` | Event logs grow indefinitely; unable to prune historical events prior to snapshot checkpoints. |
| **Durable Diagnostic Trace Store** | `docs/system/06-persistence.md` §6 | Stubbed (`InMemoryTraceStore`) | `MH-AUDIT-GAP-002` | All diagnostic telemetry events evaporate on process restart or crash. |
| **Artifact DAG Cycle Validator** | `docs/system/01-task-graph.md` §3 | Partial | `MH-AUDIT-GAP-003` | Cyclic artifact producer-consumer graphs pass validation and cause scheduler deadlock. |
| **Multi-Language Repository Indexer** | `docs/system/02-planning.md` §2 | TS/JS Only | `MH-AUDIT-GAP-004` | AST snapshotting works only for TypeScript/JavaScript, failing for Python, Rust, Go codebases. |
| **Incremental Snapshot Delta Folding** | `docs/system/06-persistence.md` §3 | Unbuilt | `MH-AUDIT-GAP-005` | Every snapshot write recalculates full state from event 0 instead of applying deltas. |
| **Worktree & Artifact GC Subsystem** | `docs/system/05-worktree-layer.md` §5 | Manual / Uncalled | `MH-AUDIT-GAP-006` | Physical worktrees and temporary artifact files leak on disk until manually removed. |
| **Web API Authentication & Middleware** | `docs/system/security-boundary.md` §1 | Unbuilt | `MH-AUDIT-API-006` | All 17 Web API endpoints execute without session verification or authorization checks. |

---

## 3. Transition Gaps Ledger (Code Implementation vs Target Docs)

1. **Dual Task Graph Models**: `packages/task-graph` exports legacy `TaskNode` (which embeds runtime status `planned/running/done` inside the graph node) alongside V2 `TaskNodeV2` and `GraphRevision` (where status is managed strictly by `RunCoordinator` event reductions per `docs/system/01-task-graph.md`).
2. **Dual Execution Pipelines**: `packages/execution-core` maintains legacy `src/run/executor.ts` alongside V2 `src/v2/exact-candidate-validator.ts` and `src/v2/node-executor.ts`.
3. **Web Repository Adapter Layer**: `apps/web/src/lib/server/runs/repository.ts` bridges V2 event-sourced projections into legacy in-memory run state caches, introducing cache drift risks during multi-process execution.
