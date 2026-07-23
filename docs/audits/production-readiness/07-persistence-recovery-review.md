# 07 — Persistence, Store Integrity & Recovery Audit

**Audit Date**: 2026-07-21  
**Target Subsystems**: `packages/run-store`, `packages/trace-store`, `packages/execution-core` (journals), `apps/web/src/lib/server/`  
**Target Specs**: `docs/system/06-persistence-and-recovery.md`  
**Auditor**: Teamwork Explorer (Persistence & Recovery Specialist)  

---

## 1. Persistence Subsystem Architecture

ManyHands uses append-only JSONL files (`*.events.v2.jsonl`) for domain event storage, compare-and-swap (CAS) snapshot persistence (`RunSnapshotStore`), immutable attempts (`JsonlAttemptStore`), and immutable artifact manifests (`JsonlArtifactStore`).

While canonical event upcasting and JSONL schemas function cleanly, the audit identified **10 critical persistence and crash recovery defects**, spanning file locking race conditions, missing `fsync` file durability, attempt lifecycle state blocks, and atomic write file leaks.

---

## 2. Audit Findings Summary (`MH-AUDIT-PERS-xxx`)

| Issue ID | Severity | Location | Short Description |
|---|---|---|---|
| `MH-AUDIT-PERS-001` | **P0 (Critical)** | `packages/run-store/src/jsonl-event-store.ts:180` | `acquireDurableLock` release callback unconditionally deletes `lockPath` without verifying owner PID. |
| `MH-AUDIT-PERS-002` | **P1 (High)** | `packages/run-store/src/jsonl-event-store.ts:254-269` | Transient rename retries lack delay and leave stranded `.tmp` files on rename failure. |
| `MH-AUDIT-PERS-004` | **P1 (High)** | `packages/trace-store/src/index.ts:24-60` | Ephemeral trace logging via `InMemoryTraceStore` causes diagnostic telemetry evaporation on process exit. |
| `MH-AUDIT-PERS-006` | **P1 (High)** | `packages/run-store/src/attempt-store.ts:40-75` | `JsonlAttemptStore` lacks an `update()` method, preventing attempts created as `"created"` from transitioning status. |
| `MH-AUDIT-PERS-003` | **P2 (Medium)** | `packages/run-store/src/snapshot-store.ts:83` | `RunSnapshotStore.atomicWrite` lacks retry backoff logic for Windows transient file locks. |
| `MH-AUDIT-PERS-005` | **P2 (Medium)** | `packages/run-store/src/jsonl-event-store.ts:110` | Corrupt trailing records in degraded event logs are read without auto-truncating corrupt bytes. |
| `MH-AUDIT-PERS-007` | **P2 (Medium)** | `packages/execution-core/src/v2/journal.ts:60` | Process evidence journal lacks atomic file writing, risking partial JSON output on unexpected crash. |
| `MH-AUDIT-PERS-008` | **P2 (Medium)** | `packages/run-store/src/jsonl-event-store.ts:150` | Missing lock heartbeat mechanism for writes exceeding `LOCK_STALE_AFTER_MS` (30s). |
| `MH-AUDIT-PERS-009` | **P3 (Low)** | `packages/run-store/src/artifact-store.ts:50` | Missing `fsync` call before file rename in `JsonlArtifactStore`. |
| `MH-AUDIT-PERS-010` | **P3 (Low)** | `packages/run-store/src/snapshot-store.ts:120` | Snapshot store generates redundant temporary file UUIDs on every snapshot write. |

---

## 3. Deep Dive Analysis & Code Evidence

### `MH-AUDIT-PERS-001`: Unconditional Lock Release Race Condition
- **File**: `packages/run-store/src/jsonl-event-store.ts:173-180`
- **Code**:
  ```ts
  const release = () => rm(lockPath, { recursive: true, force: true });
  ```
- **Evidence**: `acquireDurableLock` creates a directory lock containing `owner.json`. If Process A takes longer than 30,000ms (`LOCK_STALE_AFTER_MS`), Process B considers Process A's lock stale, removes `lockPath`, creates a new `lockPath` directory with Process B's `owner.json`, and enters its critical section.
- When Process A completes at 31s, its `finally` block executes `release()`, which runs `rm(lockPath, { recursive: true, force: true })`. Process A does not check if `owner.json` matches its PID. As a result, Process A deletes Process B's active lock directory, allowing Process C to enter the critical section concurrently with Process B.

### `MH-AUDIT-PERS-002`: Transient Rename Retries Lack Delay
- **File**: `packages/run-store/src/jsonl-event-store.ts:258-268`
- **Analysis**: In `atomicWrite`, `for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1)` retries `rename(temporary, filePath)` without any `delay()`. All 5 retries execute in under 1ms. If an anti-virus or indexer holds a lock for 10ms, all retries fail. Furthermore, if `rename` fails, `temporary` is never unlinked, leaking `.tmp` files.
