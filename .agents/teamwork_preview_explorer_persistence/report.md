# Comprehensive Persistence & Recovery Audit Report

**Auditor**: Teamwork Explorer (Persistence & Recovery Specialist)  
**Date**: 2026-07-21  
**Scope**: `packages/run-store`, `packages/trace-store`, `packages/execution-core` (journals), and `apps/web/src/lib/server/` persistence adapters  
**Output Path**: `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_persistence\report.md`

---

## Executive Summary

An in-depth audit of ManyHands persistence and crash recovery mechanisms was conducted across `packages/run-store`, `packages/trace-store`, `packages/execution-core`, and `apps/web`. 

While the system enforces canonical domain event schema upcasting, compare-and-swap (CAS) event sequence fencing, and immutable artifact adoption, several **critical defects** exist in file locking, atomic write mechanics, diagnostic trace persistence, attempt status lifecycle tracking, and I/O scalability.

Ten (10) specific audit findings (`MH-AUDIT-PERS-001` through `MH-AUDIT-PERS-010`) were identified with exact source line references, root cause analysis, severity ratings, and actionable remediation steps.

---

## Summary of Invariants Audit

| Invariant | Status | Findings & Status Summary |
| --- | --- | --- |
| **Canonical domain events vs diagnostic traces** | ⚠️ Partial Violation | Canonical domain events (`*.events.v2.jsonl`) are persisted durably via `JsonlRunEventStore`. However, diagnostic traces (`TraceEvent`) are kept **only in Node memory** via `InMemoryTraceStore` and evaporate on process restart/completion (`MH-AUDIT-PERS-004`). |
| **Immutability of attempts and InputFingerprint verification** | ⚠️ Blocked Lifecycle | `computeInputFingerprint` and `decideAttemptAdoption` verify attempt eligibility correctly. However, `JsonlAttemptStore.create()` enforces rigid immutability without an `update()` method, preventing attempts created as `status: "created"` from transitioning to `status: "finished"` or `status: "failed"` (`MH-AUDIT-PERS-006`). |
| **Atomic file writing (tmp write + rename vs direct write)** | ❌ Inconsistent & Flawed | Atomic writes write to `.tmp` files before `rename()`. However, `packages/run-store` lacks `fsync` before rename, lacks delay between Windows transient rename retries, and leaks `.tmp` files on failure (`MH-AUDIT-PERS-002`, `MH-AUDIT-PERS-003`, `MH-AUDIT-PERS-009`, `MH-AUDIT-PERS-010`). |
| **Event log corruption recovery and replay safety** | ⚠️ Partial Recovery | Incomplete trailing lines are correctly detected as `status: "degraded"` during inspection. However, `load()` permits reading degraded logs without auto-repairing or truncating the corrupt trailing record on disk (`MH-AUDIT-PERS-005`). |
| **Concurrent file access & locking issues** | ❌ High Vulnerability | `acquireDurableLock` and `withFilesystemLock` contain a severe race condition: `release()` unconditionally deletes `lockPath` without verifying lock ownership, destroying new locks acquired after a takeover (`MH-AUDIT-PERS-001`). Long writes (>30s) lose locks due to missing heartbeats (`MH-AUDIT-PERS-008`). |

---

## Detailed Audit Findings

### `MH-AUDIT-PERS-001`: Unconditional Lock Release Deletes Active Foreign Locks
- **Severity**: High
- **Category**: Concurrency & File Locking Race Condition
- **File & Lines**: `packages/run-store/src/jsonl-event-store.ts:173-197` (specifically line 180)
- **Description**:
  In `acquireDurableLock`, when a process acquires a lock directory, it creates `lockPath` and writes `owner.json`. The returned release callback is:
  ```ts
  return () => rm(lockPath, { recursive: true, force: true });
  ```
  If Process A acquires the lock, but its execution takes longer than `LOCK_STALE_AFTER_MS` (30,000ms), Process B waiting on the lock considers Process A's lock stale, removes `lockPath`, creates a new `lockPath` directory with Process B's `owner.json`, and enters its critical section.
  When Process A finally completes, its `finally` block executes `release()`, which runs `rm(lockPath, { recursive: true, force: true })`. Process A **does not inspect `owner.json`** to check if it still owns the lock. As a result, Process A deletes Process B's active lock directory. Process C can then immediately acquire `lockPath` via `mkdir`, leading to concurrent execution of Process B and Process C inside the critical section.
- **Impact**: Multi-process lock corruption and concurrent un-fenced writes to `.events.v2.jsonl` and snapshot stores.
- **Recommendation**:
  Update `acquireDurableLock` release callback to inspect `owner.json` inside `lockPath`. Only delete `lockPath` if `owner.json` contains the process's exact PID and `acquiredAt` timestamp.

---

### `MH-AUDIT-PERS-002`: Transient Rename Retries Lack Delay and Leak Stranded `.tmp` Files
- **Severity**: Medium
- **Category**: Atomic Write Durability & File System Integrity
- **File & Lines**: `packages/run-store/src/jsonl-event-store.ts:254-269`
- **Description**:
  In `JsonlRunEventStore.atomicWrite`:
  ```ts
  async function atomicWrite(filePath: string, contents: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, contents, "utf8");
    let lastError: unknown;
    for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
      try {
        await rename(temporary, filePath);
        return;
      } catch (error) {
        lastError = error;
        if (!isRetryableRename(error) || attempt === RENAME_RETRIES - 1) throw error;
      }
    }
    throw lastError;
  }
  ```
  1. The `for` loop retries `rename(temporary, filePath)` on `EPERM`, `EACCES`, or `EBUSY` without any `delay()`. All 5 retries execute within <1 millisecond. If a Windows file scanner or indexer holds a lock for 10ms, all 5 attempts fail immediately.
  2. If `rename` throws (either after 5 retries or on a non-retryable error), the temporary file is never removed and remains stranded on disk indefinitely.
- **Impact**: Transient Windows sharing violations cause unnecessary write failures, and orphaned `.tmp` files accumulate over time.
- **Recommendation**:
  Add exponential backoff delay between retry attempts (e.g. 10ms, 25ms, 50ms) and wrap the `rename` execution in a `try...finally` block that removes `temporary` if `rename` fails.

---

### `MH-AUDIT-PERS-003`: Non-Resilient Atomic Writes in Snapshot, Attempt, and Artifact Stores
- **Severity**: Medium
- **Category**: Atomic Write Durability
- **File & Lines**:
  - `packages/run-store/src/snapshot-store.ts:83-88`
  - `packages/run-store/src/attempt-store.ts:30-32`
  - `packages/run-store/src/artifact-store.ts:46-48`
- **Description**:
  `RunSnapshotStore`, `JsonlAttemptStore`, and `JsonlArtifactStore` perform atomic writes by creating temporary files and renaming them:
  ```ts
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, filePath);
  ```
  These implementations:
  1. Do not retry `rename()` on transient Windows file system locks (`EPERM`, `EBUSY`, `EACCES`).
  2. Do not issue `fsync` on the file handle before calling `rename()`.
  3. Do not clean up `temporary` if `rename()` fails.
- **Impact**: Higher error rates under Windows environments during concurrent reads/writes and accumulation of abandoned `.tmp` files.
- **Recommendation**:
  Standardize all persistence stores to use a centralized, durable atomic write function (e.g. `atomicWriteJson` from `apps/web/src/lib/server/workspaces/atomic-write.ts`).

---

### `MH-AUDIT-PERS-004`: Complete Loss of Diagnostic Traces Due to In-Memory Only Store
- **Severity**: High
- **Category**: Trace Logging & Observability Gaps
- **File & Lines**: `packages/trace-store/src/index.ts:101-142` & `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:112`
- **Description**:
  The ManyHands target architecture explicitly distinguishes between canonical domain events (`RunEvent`) and diagnostic traces (`TraceEvent`). Diagnostic events record fine-grained execution information (e.g., `agent_started`, `executor_output`, `cherry_pick_conflict`, `repair_syntax_rejected`).
  However, `packages/trace-store` only provides `InMemoryTraceStore`. In `execution-pipeline.ts`, execution initializes:
  ```ts
  const traceStore = new InMemoryTraceStore();
  ```
  No persistent `FileTraceStore` or `JsonlTraceStore` exists anywhere in the repository. As a result, all diagnostic traces emitted during execution exist solely in process memory and evaporate as soon as the Node.js process terminates or restarts.
- **Impact**: Operational diagnostics and agent execution logs are completely lost on process exit. Troubleshooting failed runs or auditing agent behavior post-mortem is impossible.
- **Recommendation**:
  Implement a durable `JsonlTraceStore` in `packages/trace-store` that appends trace events to a `.traces.v2.jsonl` file.

---

### `MH-AUDIT-PERS-005`: Lossy Handling of Degraded Trailing Partial Records
- **Severity**: Medium
- **Category**: Event Log Recovery & Repair
- **File & Lines**: `packages/run-store/src/jsonl-event-store.ts:51-57, 100-101, 218-222`
- **Description**:
  In `inspectRawLog`, if an un-flushed trailing record exists at the end of `.events.v2.jsonl` (e.g., due to a crash during write), the log inspection sets `status: "degraded"`.
  When `load(runId)` is called:
  ```ts
  async function load(runId: string): Promise<RunEvent[]> {
    const inspection = await this.inspect(runId);
    if (inspection.status === "corrupt") {
      throw new CorruptRunEventLogError(runId, inspection.reason ?? "invalid durable record");
    }
    return inspection.events;
  }
  ```
  `load()` does not throw for `"degraded"` status and successfully returns all valid preceding events. However, `load()` is a read-only method and does not repair or truncate the damaged trailing bytes on disk. If a user or system component repeatedly queries `load()` or `inspect()` without appending new events, the log file remains degraded on disk forever.
- **Impact**: Degraded log files persist indefinitely on disk unless an append operation overwrites the file.
- **Recommendation**:
  Provide an explicit `repair(runId)` method on `JsonlRunEventStore` or auto-truncate incomplete trailing records during `load()` if degraded status is detected.

---

### `MH-AUDIT-PERS-006`: Inability to Persist Attempt Lifecycle Status Updates
- **Severity**: High
- **Category**: Immutability & Attempt State Management
- **File & Lines**: `packages/run-store/src/attempt-store.ts:18-35`
- **Description**:
  `AttemptRecordSchema` defines an attempt's `status` field with values `"created" | "running" | "finished" | "stale" | "adopted" | "failed"`.
  However, `JsonlAttemptStore` only exposes a `create()` method:
  ```ts
  const existing = current.find((item) => item.attemptId === attempt.attemptId);
  if (existing !== undefined) {
    if (JSON.stringify(existing) === JSON.stringify(attempt)) return existing;
    throw new ImmutableAttemptConflictError(`Attempt ${attempt.attemptId} already exists with different evidence.`);
  }
  ```
  If an attempt record is created at node execution start with `status: "created"` or `status: "running"`, any subsequent call to update its status to `"finished"` or `"failed"` under the same `attemptId` is rejected by `create()` with `ImmutableAttemptConflictError`.
- **Impact**: Attempt lifecycle progression cannot be durably tracked in `JsonlAttemptStore`.
- **Recommendation**:
  Either model attempt execution outcomes as immutable separate records or add a controlled state transition method (`updateStatus`) in `JsonlAttemptStore` that permits status transitions while preserving original `inputFingerprint`.

---

### `MH-AUDIT-PERS-007`: $O(N^2)$ Disk I/O Bottleneck via Full Event Journal Rewrite on Append
- **Severity**: Medium
- **Category**: File I/O Scalability & Performance
- **File & Lines**: `packages/run-store/src/jsonl-event-store.ts:120, 236-239`
- **Description**:
  In `appendFenced`:
  ```ts
  await writeDurableEvents(this.eventLogPath(runId), [...inspection.events, ...appended]);
  ```
  Instead of opening `.events.v2.jsonl` in append mode (`a` or `a+`), `writeDurableEvents` serializes all existing events plus the new events into a string and overwrites the entire log file via `atomicWrite` (write temp file + rename).
  For a run with $N$ events, appending a single event requires re-reading $N-1$ events, re-serializing $N$ events, writing all $N$ events to a new temporary file, and renaming it over the destination. Over the life of a run with $N$ events, total disk I/O scales as $O(N^2)$.
- **Impact**: Severe disk I/O thrashing and performance degradation on long-running executions with hundreds or thousands of events.
- **Recommendation**:
  Use true append-only file operations (`fs.appendFile`) for appending new JSONL envelopes, reserving full atomic rewrites for explicit log compaction or repair.

---

### `MH-AUDIT-PERS-008`: Lock Expiration and Split-Brain Writes During Long Operations
- **Severity**: High
- **Category**: Lock Expiration & Lack of Heartbeating
- **File & Lines**:
  - `packages/run-store/src/jsonl-event-store.ts:185` (`LOCK_STALE_AFTER_MS = 30_000`)
  - `packages/execution-core/src/integration/operation-journal.ts:194` (`30_000` ms)
- **Description**:
  Both `acquireDurableLock` in `jsonl-event-store.ts` and `withFilesystemLock` in `operation-journal.ts` determine lock staleness using directory modification time:
  ```ts
  if (Date.now() - info.mtimeMs > LOCK_STALE_AFTER_MS) {
    await rm(lockPath, { recursive: true, force: true });
    continue;
  }
  ```
  If a write operation (e.g. generating a massive graph snapshot or running a long validation step inside `withFencedWrite`) takes longer than 30 seconds, `mtime` is never refreshed during the operation. Another process attempting to write will perceive the lock as stale, delete the lock directory, acquire a new lock, and begin writing concurrently.
- **Impact**: Split-brain concurrent writes and data corruption when operations exceed 30 seconds.
- **Recommendation**:
  Implement an active lock heartbeat/touch interval during active lock ownership, or pass lock tokens to prevent foreign takeover while the holding PID is alive.

---

### `MH-AUDIT-PERS-009`: Fragmented and Inconsistent Atomic Write Implementations Across Workspace & Core
- **Severity**: Medium
- **Category**: Architectural Consistency & Maintenance Risk
- **File & Lines**:
  - `apps/web/src/lib/server/workspaces/atomic-write.ts`
  - `packages/run-store/src/jsonl-event-store.ts`
  - `packages/run-store/src/snapshot-store.ts`
  - `packages/execution-core/src/integration/operation-journal.ts`
- **Description**:
  There are at least 4 separate implementations of atomic writes across the codebase:
  1. `apps/web/src/lib/server/workspaces/atomic-write.ts`: Supports `open("wx")`, file `fsync`, directory sync, exponential backoff retries, and cleanup.
  2. `packages/run-store/src/jsonl-event-store.ts`: Supports 5 zero-delay retries, no `fsync`, no temp file cleanup.
  3. `packages/run-store/src/snapshot-store.ts`: No retries, no `fsync`, no temp file cleanup.
  4. `packages/execution-core/src/integration/operation-journal.ts`: No retries, no `fsync`, no temp file cleanup.
- **Impact**: Inconsistent durability, varying fault tolerance across sub-systems, and duplicated code prone to regressions.
- **Recommendation**:
  Refactor all store implementations to share a single, well-tested atomic write utility (e.g., from `@manyhands/shared` or `@manyhands/run-store`).

---

### `MH-AUDIT-PERS-010`: Absence of `fsync` Call Before Atomic File Renames in `packages/run-store`
- **Severity**: High
- **Category**: Data Durability & OS Crash Safety
- **File & Lines**:
  - `packages/run-store/src/jsonl-event-store.ts:257`
  - `packages/run-store/src/snapshot-store.ts:86`
- **Description**:
  When `JsonlRunEventStore` and `RunSnapshotStore` execute atomic writes, they write content using Node's `writeFile(temporary, contents)` and immediately call `rename(temporary, filePath)`.
  Without calling `handle.sync()` or `fsync()` on the temporary file descriptor before `rename()`, data resides only in the operating system's in-memory page cache. If an operating system crash, sudden power outage, or hard reboot occurs shortly after `rename()` finishes, the directory entry will be committed to disk pointing to un-synced file blocks, resulting in **0-byte or corrupted event logs and snapshots**.
- **Impact**: Loss of domain event journal entries or snapshot corruption following system power loss or OS failure.
- **Recommendation**:
  Use `fs.open`, write payload, call `handle.sync()` (when durable writes are enabled), close handle, and only then call `rename()`.

---

## Architectural Alignment & Transition Gaps

1. **Diagnostic Traces vs Domain Events**:
   - *Target Architecture*: Domain events are canonical; snapshots are projections; traces are diagnostics.
   - *Transition Gap*: Diagnostic traces are stored exclusively in-memory (`InMemoryTraceStore`), violating post-execution diagnostic retention requirements.
2. **Atomic Write Standard**:
   - *Target Architecture*: All durable storage writes must be atomic, fsynced by default, and retryable under OS file locks.
   - *Transition Gap*: `packages/run-store` and `packages/execution-core` implement simplified atomic writes lacking `fsync`, backoff, and temp file cleanup.

---

## Conclusion & Remediation Plan

To bring ManyHands persistence and crash recovery to production readiness, the following phased remediation plan is recommended:

1. **Phase 1 (Immediate Fixes - Concurrency & Durability)**:
   - Fix `acquireDurableLock` in `jsonl-event-store.ts` to check `owner.json` before deleting lock directories on release (`MH-AUDIT-PERS-001`).
   - Add `fsync` and exponential backoff retry logic to `atomicWrite` in `jsonl-event-store.ts` and `snapshot-store.ts` (`MH-AUDIT-PERS-002`, `MH-AUDIT-PERS-003`, `MH-AUDIT-PERS-010`).
   - Add lock heartbeating or owner PID check to prevent 30s lock timeout takeovers (`MH-AUDIT-PERS-008`).

2. **Phase 2 (Lifecycle & Store Features)**:
   - Implement `JsonlTraceStore` in `packages/trace-store` and update `execution-pipeline.ts` (`MH-AUDIT-PERS-004`).
   - Support attempt lifecycle status updates in `JsonlAttemptStore` (`MH-AUDIT-PERS-006`).
   - Switch `JsonlRunEventStore.appendFenced` from full file overwrite to `fs.appendFile` (`MH-AUDIT-PERS-007`).

3. **Phase 3 (Unification & Maintenance)**:
   - Consolidate all atomic file write utilities into a single package (`@manyhands/shared`) (`MH-AUDIT-PERS-009`).
   - Add explicit degraded log repair logic in `JsonlRunEventStore` (`MH-AUDIT-PERS-005`).
