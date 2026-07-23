# Handoff Report — Persistence & Recovery Audit

## 1. Observation
- `packages/run-store/src/jsonl-event-store.ts:180`: Lock release function is `() => rm(lockPath, { recursive: true, force: true })`, which unconditionally deletes `lockPath` without verifying owner identity.
- `packages/run-store/src/jsonl-event-store.ts:254-269`: `atomicWrite` retries `rename` 5 times with `delay(0)` (no delay) and leaves `.tmp` files stranded on disk if `rename` fails.
- `packages/run-store/src/snapshot-store.ts:83-88`, `attempt-store.ts:30-32`, `artifact-store.ts:46-48`: Atomic write calls `rename` without transient retries, without `fsync`, and without `finally` cleanup of `.tmp` files.
- `packages/trace-store/src/index.ts:101-142` & `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:112`: Only `InMemoryTraceStore` exists in `trace-store`. `execution-pipeline.ts` instantiates `new InMemoryTraceStore()`, causing all diagnostic trace events to evaporate on process exit/restart.
- `packages/run-store/src/jsonl-event-store.ts:51-57, 100-101, 218-222`: Trailing incomplete records are marked `status: "degraded"`. `load()` returns valid events up to that point without auto-repairing or truncating the file on disk.
- `packages/run-store/src/attempt-store.ts:18-35`: `JsonlAttemptStore.create()` rejects updating existing `attemptId` with different status/digest with `ImmutableAttemptConflictError`, leaving no way to record `running` -> `finished` status transitions.
- `packages/run-store/src/jsonl-event-store.ts:120, 236-239`: `appendFenced` overwrites the entire `.events.v2.jsonl` file on every single event append ($O(N^2)$ cumulative I/O).
- `packages/run-store/src/jsonl-event-store.ts:185` & `packages/execution-core/src/integration/operation-journal.ts:194`: Lock timeout is hardcoded to 30,000ms with no heartbeat mechanism, causing operations taking >30s to lose exclusive lock access.
- `apps/web/src/lib/server/workspaces/atomic-write.ts` vs `packages/run-store/src/jsonl-event-store.ts`: Disparate implementations of atomic writes with conflicting error handling, fsync usage, and backoff logic.
- `packages/run-store/src/jsonl-event-store.ts:257` & `packages/run-store/src/snapshot-store.ts:86`: No `fsync` call prior to `rename()`, making writes vulnerable to OS crash page cache loss.

## 2. Logic Chain
1. *Durable Lock Release Deletion*: When `acquireDurableLock` times out or considers a lock stale (>30s), Process B deletes Process A's lock directory and creates a new one. When Process A finally completes, its `release()` calls `rm(lockPath)` without checking if `owner.json` matches its own pid/token. This deletes Process B's lock, allowing Process C to acquire the lock concurrently.
2. *Ephemeral Diagnostic Traces*: Diagnostic trace events (`TraceEvent`) record operational history like agent steps, executor output, and repair syntax rejections. Because `InMemoryTraceStore` is used without a persistent backend, all diagnostic history is lost on process restart or finish, violating target architecture requirement for diagnostic trace recording.
3. *Attempt Immutability Lockout*: `AttemptRecordSchema` defines lifecycle statuses (`created`, `running`, `finished`, `failed`). `JsonlAttemptStore.create()` rejects writing an updated record with the same `attemptId` if any field differs. Without an `update()` method, execution attempt progress cannot be persisted.
4. *File I/O Overhead*: Overwriting the entire `.events.v2.jsonl` file on every `appendFenced()` call causes $O(N^2)$ disk writes for $N$ events, leading to severe slowdowns and heavy disk thrashing during long runs.

## 3. Caveats
- No code modifications were performed in this audit (read-only investigation).
- Tests in `tests/atomic-write-durability.test.ts` verify `apps/web/src/lib/server/workspaces/atomic-write.ts`, but do not test `packages/run-store`'s `atomicWrite`.

## 4. Conclusion
The persistence and recovery mechanisms in ManyHands contain critical gaps and vulnerabilities across locking, atomic writing, attempt tracking, and trace logging. Ten specific flaws (`MH-AUDIT-PERS-001` through `MH-AUDIT-PERS-010`) have been identified with exact line numbers, logic chains, and severity ratings in `report.md`.

## 5. Verification Method
1. Inspect `packages/run-store/src/jsonl-event-store.ts:180` to verify `release()` calls `rm(lockPath, { recursive: true, force: true })` without owner check.
2. Inspect `packages/trace-store/src/index.ts` to confirm no persistent `FileTraceStore` exists.
3. Inspect `packages/run-store/src/attempt-store.ts:22-26` to confirm attempt status update attempts throw `ImmutableAttemptConflictError`.
4. Run `pnpm test` to verify existing persistence test coverage behavior.
