# 01 — Validated Findings Master Catalog

**Audit Date**: 2026-07-22  
**Reviewer**: Planning Worker 1 (Findings Validation & Audit Integrity Reviewer)  
**Scope**: All 81 Primary Audit Findings (`MH-AUDIT-001` through `MH-AUDIT-081`)  
**Target Product Vision**: ManyHands Local Single-User Self-Hosted Developer Application (Localhost Execution)  

---

## Executive Summary & Classification Schema

Each finding in this catalog has been inspected against the live ManyHands codebase, validated, and classified under the **Local Single-User Self-Hosted Threat Model**:

- **Status**: `CONFIRMED`, `RECLASSIFIED`, `MERGED_DUPLICATE`, `REJECTED_FALSE_POSITIVE`
- **Classifications**:
  - `BLOCKER_LOCAL_PRODUCT`: Critical defects causing data loss, local workspace contamination, process tree leaks, or DAG execution deadlocks.
  - `REQUIRED_FOR_LOCAL_RELIABILITY`: Important durability, resource management, and crash recovery fixes for long-running local executions.
  - `LOCAL_HARDENING`: Security, prompt injection, input validation, and process isolation hardening.
  - `OPTIONAL_IMPROVEMENT`: Code polish, minor refactoring, and UI token formatting.
  - `OUT_OF_SCOPE_SAAS`: Multi-tenant cloud features (OAuth/SSO, SaaS RBAC, public internet session auth).
- **Product Readiness Levels**:
  - **Level A (Local Thesis & Core Integrity)**: Host safety & fundamental graph correctness.
  - **Level B (Secure Local Use)**: Worktree sandbox, process termination, resource caps, prompt injection defense.
  - **Level C (Reliable Local Beta)**: Long-run durability, append stream performance, crash recovery.
  - **Level D (Finished Local Product)**: 100% test pass rate, clean monorepo builds, local localhost CSRF protection.

---

## 1. Git & Worktree Boundary Layer (`MH-AUDIT-GIT-xxx`)

### `MH-AUDIT-GIT-010`: Grounding Agent Stages and Commits User Dirty Workspace
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/run/grounding-agent.ts:77-101`
- **Original Severity**: 🔴 P0 Critical | **Validated Severity**: 🔴 P0 Critical
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level A
- **Description**: `GroundingAgent.run` writes walking skeleton files into `params.repoRoot` and invokes `git.addAllExcluding` without checking `git.statusPorcelain()`. If the user has uncommitted files in their working copy, `GroundingAgent` forcibly stages and commits user dirty files under `"mh-grounding: walking skeleton scaffold"`.
- **Root Cause**: Omitting working directory status verification before executing stage-and-commit operations.
- **Remediation Rationale**: Inspect `git.statusPorcelain(params.repoRoot)` before modifying files. Abort or create an isolated worktree if the workspace is dirty.

### `MH-AUDIT-GIT-001`: V2 Execution Pipeline Leaks Worktrees & Branches on Exit
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:111`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: `driveClaimedExecutionV2` drives graph execution but omits calling `worktrees.gcRun(runId)` in its `finally` block on run completion or failure, leaving orphan physical worktree folders on disk.
- **Root Cause**: Missing lifecycle cleanup barrier (`finally` block) in execution coordinator pipeline wrapper.
- **Remediation Rationale**: Wrap execution pipeline in `try...finally` to ensure `worktrees.gcRun(runId)` is executed unconditionally.

### `MH-AUDIT-GIT-005`: Concurrent Git Operations Contend on `.git/index.lock`
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/git/runner.ts:102-136`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: Concurrent `git worktree add` and ref deletion operations race on the repository's `.git/index.lock` file without exponential retry/backoff, causing parallel task execution failures.
- **Root Cause**: Direct execution of mutating Git commands without locking or retry handling for transient lock contention.
- **Remediation Rationale**: Add exponential backoff retry wrapper for Git commands susceptible to `.git/index.lock` contention.

### `MH-AUDIT-GIT-007`: Missing Fallback Git Committer Identity in `SimpleGitRunner`
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/git/runner.ts:220-225`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: `SimpleGitRunner.commit` executes `git commit` without verifying if global `user.name` and `user.email` are configured in the host environment, crashing on fresh developer installs.
- **Root Cause**: Assumption that host environment always has global Git identity pre-configured.
- **Remediation Rationale**: Pass `-c user.name="ManyHands Bot" -c user.email="bot@manyhands.local"` default overrides on Git commit calls.

### `MH-AUDIT-GIT-002`: `WorktreeManager.clean` Aborts Before Branch Deletion
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/worktree/manager.ts:295-317`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: If `git worktree remove` throws an exception during `WorktreeManager.clean`, execution halts immediately before branch deletion, stranding temporary Git branches.
- **Root Cause**: Sequential cleanup statements executed without individual `try...catch` isolation blocks.
- **Remediation Rationale**: Wrap individual worktree directory removal and branch deletion in separate `try...catch` handlers.

### `MH-AUDIT-GIT-003`: Windows Orphaned Physical Worktree Directory Deletion Failure
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/worktree/manager.ts:295-317`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: `WorktreeManager.clean` relies solely on `git worktree remove`, which fails on Windows when background process file locks linger, leaving physical directories.
- **Root Cause**: Windows file locking semantics preventing `git worktree remove` from deleting active directory handles.
- **Remediation Rationale**: Add fallback recursive directory removal using `fs.rm(path, { recursive: true, force: true })` with retry backoff.

### `MH-AUDIT-GIT-004`: Missing GPG Signing Override Causes Background Commit Hangs
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/git/runner.ts:95-100`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level B
- **Description**: Background Git commit calls do not specify `-c commit.gpgsign=false`, causing execution to hang indefinitely when host Git config enables GPG signing globally.
- **Root Cause**: Omitting explicit GPG signing suppression flags on automated background commits.
- **Remediation Rationale**: Append `-c commit.gpgsign=false` to all automated Git commit options.

### `MH-AUDIT-GIT-006`: Validation Worktree Setup Fails to Prune Untracked Files
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/v2/exact-candidate-validator.ts:140`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Setting up exact candidate validation worktrees does not execute `git clean -fdx` before checking out candidate commits, leaving dirty untracked build artifacts that distort test results.
- **Root Cause**: Assuming checkout over existing worktrees produces clean commit states.
- **Remediation Rationale**: Invoke `git clean -fdx` prior to checking out target commits in candidate validation worktrees.

### `MH-AUDIT-GIT-008`: Worktree Path Hashing Collisions on Identical Run Prefix Segments
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/worktree/manager.ts:180`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Short truncated hashing for worktree directory paths can produce collisions when run IDs share identical prefix strings.
- **Root Cause**: Truncating SHA-256 hash digests to short substring lengths without checking uniqueness.
- **Remediation Rationale**: Use full 12-character hex digest slices combined with sanitized run IDs for worktree directory naming.

### `MH-AUDIT-GIT-009`: Unparsed Stderr Strings on Successful Git Commands Output False Warnings
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/git/runner.ts:45`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Git outputs non-fatal informational messages (e.g. `Switched to branch...`) to `stderr`. Parsing any non-empty `stderr` as an error generates false warning logs.
- **Root Cause**: Checking `stderr.length > 0` instead of exit codes to determine command success.
- **Remediation Rationale**: Treat non-zero exit codes as errors and filter benign Git informational messages from log output.

### `MH-AUDIT-GIT-011`: `gcRun` Log Output Exposes Host Absolute Paths
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/worktree/manager.ts:320`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Log messages emitted during worktree garbage collection print unredacted absolute host filesystem paths, exposing host username in logs.
- **Root Cause**: Direct interpolation of `path.resolve` strings into logger metadata.
- **Remediation Rationale**: Relative-format or sanitize filesystem paths before printing to log streams.

### `MH-AUDIT-GIT-012`: Hardcoded Git Binary Path Invocations Fail on Custom Windows Paths
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/git/runner.ts:310`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Directly executing `"git"` assumes Git exists on system `PATH`. When installed in non-standard Windows locations, process spawning fails.
- **Root Cause**: Lack of dynamic executable location discovery for Git binary.
- **Remediation Rationale**: Add dynamic Git binary resolution falling back to standard Windows installation paths.

---

## 2. Persistence & Recovery Layer (`MH-AUDIT-PERS-xxx`)

### `MH-AUDIT-PERS-001`: Unconditional Lock Release Deletes Active Foreign Locks
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/jsonl-event-store.ts:173-197`
- **Original Severity**: 🔴 P0 Critical | **Validated Severity**: 🔴 P0 Critical
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level A
- **Description**: `acquireDurableLock` returns a release callback `() => rm(lockPath, { recursive: true, force: true })`. If Process A exceeds lock timeout (30s) and Process B takes over the lock, Process A's `finally` block deletes Process B's active lock directory without inspecting lock ownership.
- **Root Cause**: Unconditional `rm` callback omitting owner validation.
- **Remediation Rationale**: Inspect `owner.json` inside `lockPath` in the release callback. Only delete `lockPath` if PID and `acquiredAt` timestamp match the current process.

### `MH-AUDIT-PERS-002`: Transient Rename Retries Lack Delay and Leak `.tmp` Files
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/jsonl-event-store.ts:254-269`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🔴 P0 Critical
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level A
- **Description**: `JsonlRunEventStore.atomicWrite` retries failed file renames in a synchronous loop without delay, failing transient Windows file locks and leaving temporary `.tmp` files stranded.
- **Root Cause**: Retry loop lacking delay backoff and error cleanup.
- **Remediation Rationale**: Add exponential backoff delay between rename attempts and unlink `.tmp` files in a `catch` block on failure.

### `MH-AUDIT-PERS-003`: `RunSnapshotStore.atomicWrite` Lacks Retry Backoff Logic
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/snapshot-store.ts:83`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Writing snapshot state files uses single-shot atomic renames without retry logic, causing snapshot save failures on Windows under virus scan file locks.
- **Root Cause**: Direct `fs.rename` invocation without lock retry wrapper.
- **Remediation Rationale**: Shared `renameWithRetry` utility application across all store write handlers.

### `MH-AUDIT-PERS-004`: Ephemeral Trace Logging via `InMemoryTraceStore`
- **Status**: `MERGED_DUPLICATE` (Merged into `MH-AUDIT-QA-001`)
- **Target Location**: `packages/trace-store/src/index.ts:24-60`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: N/A (Duplicate)
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Duplicate finding of `MH-AUDIT-QA-001`. `InMemoryTraceStore` keeps diagnostic events strictly in memory, losing telemetry on process exit.
- **Root Cause**: Duplicate domain registration.
- **Remediation Rationale**: Remediated via primary finding `MH-AUDIT-QA-001` (`JsonlTraceStore`).

### `MH-AUDIT-PERS-005`: Degraded Event Log Handling Lacks Automatic Truncation
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/jsonl-event-store.ts:110-140`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: When reading JSONL event logs containing corrupt trailing bytes (from abrupt power loss/crashes), the store throws an unrecoverable parse error instead of truncating corrupt un-checksummed tail bytes.
- **Root Cause**: Missing partial-write recovery and tail truncation logic.
- **Remediation Rationale**: Implement inspect-and-repair log reader that truncates corrupt un-checksummed trailing lines back to the last valid line.

### `MH-AUDIT-PERS-006`: `JsonlAttemptStore` Lacks Status `update()` Method
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/attempt-store.ts:40-75`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: `JsonlAttemptStore` provides `save()` and `get()` but lacks an `update()` method, preventing attempt records created as `"created"` from transitioning to `"running"`, `"completed"`, or `"failed"`.
- **Root Cause**: Incomplete persistence interface implementation.
- **Remediation Rationale**: Implement `update(runId, attemptId, patch)` with atomic JSON rewriting.

### `MH-AUDIT-PERS-007`: Process Evidence Journal Lacks Atomic File Writing
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/v2/journal.ts:60`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Process evidence logs are written directly to disk via `fs.writeFile` without temporary file atomic swap, risking truncated JSON records on crash.
- **Root Cause**: Direct non-atomic file write invocation.
- **Remediation Rationale**: Refactor journal writers to use `atomicWrite` with `.tmp` file exchange.

### `MH-AUDIT-PERS-008`: Missing Lock Heartbeat for Operations Exceeding 30 Seconds
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/jsonl-event-store.ts:150`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Durable lock stale threshold is 30 seconds (`LOCK_STALE_AFTER_MS = 30_000`). Long-running graph compilations exceeding 30s lose lock protection because no background heartbeat touches `mtimeMs`.
- **Root Cause**: Fixed timeout threshold without background file modification touch loop.
- **Remediation Rationale**: Add periodic `fs.utimes` heartbeat interval (every 10s) while lock is held.

### `MH-AUDIT-PERS-009`: Missing `fsync` Call Before Rename in `JsonlArtifactStore`
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/artifact-store.ts:50`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: `JsonlArtifactStore` writes temporary files and renames without issuing `fs.fdatasync()` / `fs.fsync()`, risking lost writes during OS kernel panic.
- **Root Cause**: Omitting explicit storage flush barrier before directory metadata rename.
- **Remediation Rationale**: Flush file descriptor with `fs.fsync` before file rename.

### `MH-AUDIT-PERS-010`: Snapshot Store Generates Redundant Temporary File UUIDs
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/snapshot-store.ts:120`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Every snapshot write generates a new random UUID string for `.tmp` filenames, creating high garbage collector string allocation churn.
- **Root Cause**: Creating unique UUID strings per atomic write instead of reusing process-PID-based temp paths.
- **Remediation Rationale**: Use fixed PID-based temporary file names (`.tmp-pid-thread`).

---

## 3. Orchestration & Scheduler (`MH-AUDIT-ORCH-xxx`)

### `MH-AUDIT-ORCH-001`: DAG Cycle Validation Omits `ArtifactRequirement` Dependencies
- **Status**: `CONFIRMED`
- **Target Location**: `packages/task-graph/src/validate-v2.ts:44-88`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🔴 P0 Critical
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level A
- **Description**: `validateGraphRevision` validates parent-child hierarchy cycles (`node.parentId`) but completely omits `ArtifactRequirement` producer-consumer edge cycle checks. Circular artifact graphs pass validation and cause permanent scheduler deadlocks.
- **Root Cause**: Incomplete graph validation logic missing cross-node artifact edge traversal.
- **Remediation Rationale**: Construct adjacency matrix of artifact producer-consumer edges in `validateGraphRevision` and execute Kahn's cycle detection algorithm.

### `MH-AUDIT-ORCH-002`: Scheduler Ignores Compiled Graph-Level `ConflictConstraints`
- **Status**: `CONFIRMED`
- **Target Location**: `packages/scheduler/src/wave-selector-v2.ts:6-15` & `packages/orchestrator-graph/src/v2/execution-driver.ts:126`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🔴 P0 Critical
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level A
- **Description**: `selectReadyWaveV2` evaluates artifact readiness and external conflict arguments, but `execution-driver.ts` never maps or passes `GraphRevision.conflictConstraints` compiled into the graph. Conflicting nodes are scheduled simultaneously in parallel execution waves.
- **Root Cause**: Disconnect between GraphCompiler output schema and wave selector input parameters.
- **Remediation Rationale**: Map `input.graph.conflictConstraints` into the conflict constraint array inside `selectReadyWaveV2`.

### `MH-AUDIT-ORCH-003`: `V2ExecutionDriver` Parallel Driver Promise Mutation Race
- **Status**: `CONFIRMED`
- **Target Location**: `packages/orchestrator-graph/src/v2/execution-driver.ts:112-160`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: `V2ExecutionDriver.advance` mutates a single shared `recording` promise variable inside parallel node iteration loops (`recording = recording.then(...)`), causing unhandled promise rejections when wave attempts fail.
- **Root Cause**: Sequential promise chain mutation over concurrent async execution loops.
- **Remediation Rationale**: Replace promise chain variable mutation with `Promise.allSettled` array collectors.

### `MH-AUDIT-ORCH-004`: Scope Isolation Critic Over-restriction Rejects File Edits
- **Status**: `CONFIRMED`
- **Target Location**: `packages/decomposer/src/critics/scope-critic.ts:45-78`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: `reviewScopes` in decomposer critics erroneously flags planned modifications to existing codebase files as scope violations, rejecting valid multi-file refactoring plans.
- **Root Cause**: Scope critic treating existing target codebase paths as forbidden external paths.
- **Remediation Rationale**: Adjust scope critic logic to allow existing target repository files within `allowedPaths`.

### `MH-AUDIT-ORCH-005`: Seam Binding Evaluation Omits Snapshot Artifact Hashes
- **Status**: `CONFIRMED`
- **Target Location**: `packages/scheduler/src/readiness-v2.ts:55-89`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: `explainReadiness` checks artifact contract presence but does not verify if output artifact hashes match required seam binding versions, permitting stale artifacts to satisfy execution readiness.
- **Root Cause**: Presence-only checking without content digest verification.
- **Remediation Rationale**: Verify artifact digest hashes in `explainReadiness`.

### `MH-AUDIT-ORCH-006`: Legacy Graph Adapter Embeds Mutable Runtime State in `TaskNode`
- **Status**: `CONFIRMED`
- **Target Location**: `packages/task-graph/src/legacy-adapter.ts:40-75`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Legacy graph compatibility adapter embeds mutable node runtime state (`status: "running"`) inside `TaskNode`, violating target specification where `GraphRevision` is immutable.
- **Root Cause**: Backward-compatibility layer preserving legacy node schema.
- **Remediation Rationale**: Deprecate legacy graph adapter in favor of pure `GraphRevision` projections.

### `MH-AUDIT-ORCH-007`: Contract Compiler Generates Duplicate Artifact IDs
- **Status**: `CONFIRMED`
- **Target Location**: `packages/decomposer/src/compiler/contract-compiler.ts:90-120`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: When composite leaves share seam bindings, `compileContractBundles` generates identical artifact IDs for distinct contract bundles, causing artifact collisions.
- **Root Cause**: Generating artifact IDs without appending composite leaf node IDs.
- **Remediation Rationale**: Include leaf node ID in generated artifact contract ID strings.

### `MH-AUDIT-ORCH-008`: In-Flight Cancellation Fails to Interrupt Wave Promises
- **Status**: `CONFIRMED`
- **Target Location**: `packages/orchestrator-graph/src/v2/execution-driver.ts:210-240`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: When a human decision block or cancellation request arrives, active wave node execution promises continue running to completion before aborting the run.
- **Root Cause**: Lack of `AbortController` signal propagation to active node promises.
- **Remediation Rationale**: Pass `AbortSignal` to active wave promises and invoke immediate process tree termination.

### `MH-AUDIT-ORCH-009`: `reviseGraph` Lacks Revision ID Idempotency Validation
- **Status**: `CONFIRMED`
- **Target Location**: `packages/task-graph/src/graph-revision.ts:60`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Executing `reviseGraph` with duplicate operation sets produces incremented revision numbers without verifying revision content idempotency.
- **Root Cause**: Missing content hash comparison against previous revision.
- **Remediation Rationale**: Return existing graph revision if proposed operations result in identical graph state.

### `MH-AUDIT-ORCH-010`: Conflict Risk Score Rounding Drops Decimal Precision
- **Status**: `CONFIRMED`
- **Target Location**: `packages/conflict-risk/src/analyzer.ts:110`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Conflict risk score calculation rounds intermediate float values to single integers, dropping fine-grained precision for risk ranking.
- **Root Cause**: Math.round call on intermediate risk scores.
- **Remediation Rationale**: Preserve 4-decimal float precision in risk score outputs.

---

## 4. Security & Process Boundary Layer (`MH-AUDIT-SEC-xxx`)

### `MH-AUDIT-SEC-001`: Environment Secret Leakage & Supervision in Planning V2
- **Status**: `RECLASSIFIED`
- **Target Location**: `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:115-117`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level B
- **Description**: Planning V2 process spawning calls `supervisedSpawnFn` (line 115), but passes raw `env: process.env` (line 117), leaking host secrets (API keys, credentials) to CLI subprocesses.
- **Root Cause**: Passing unfiltered host `process.env` instead of sanitized environment dictionary.
- **Remediation Rationale**: Replace `env: process.env` with `buildAgentEnvironment(process.env)` to filter sensitive host keys.

### `MH-AUDIT-SEC-002`: Path Traversal in Scope Enforcement
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/scope/checker.ts:46-54`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🔴 P0 Critical
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level A
- **Description**: `ScopeChecker.check` compares raw path strings against globs without resolving `../` path traversal sequences, permitting adversarial agent actions outside the worktree.
- **Root Cause**: String-only glob matching without `path.resolve` normalization relative to worktree root.
- **Remediation Rationale**: Resolve target path against `worktreeRoot` using `path.resolve` and verify `resolved.startsWith(worktreeRoot)`.

### `MH-AUDIT-SEC-003`: Windows `.cmd`/`.bat` Flag Injection Vulnerability
- **Status**: `CONFIRMED`
- **Target Location**: `packages/shared/src/node-cli-process.ts:93-104`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level B
- **Description**: Escaping command arguments for `cmd.exe /c` on Windows with `windowsVerbatimArguments` fails to escape special characters (`%`, `^`), allowing potential flag injection.
- **Root Cause**: Complex Windows `cmd.exe` argument parsing edge cases.
- **Remediation Rationale**: Standardize argument escaping and avoid `cmd.exe` wrappers when direct executable spawning is available.

### `MH-AUDIT-SEC-004`: Lease Fencing Missing Process Abort Trigger
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/executor/process.ts:61-94`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level B
- **Description**: Running agent process handles do not listen to lease revocation signals (`repoLock.onLeaseLost`), allowing processes whose lease expired to keep running.
- **Root Cause**: Disconnected lease lifecycle listener.
- **Remediation Rationale**: Wire `repoLock.onLeaseLost` to send immediate SIGTERM/SIGKILL signals to active process trees.

### `MH-AUDIT-SEC-005`: Subprocess Tree Leak on Windows When Taskkill Fails
- **Status**: `CONFIRMED`
- **Target Location**: `packages/shared/src/node-cli-process.ts:145-149`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level B
- **Description**: When `taskkill /t /f` fails on Windows, fallback `child.kill()` kills only the parent Node process, stranding child CLI process trees.
- **Root Cause**: Node `child.kill()` on Windows not terminating child process trees.
- **Remediation Rationale**: Retry `taskkill` via PowerShell `Get-CimInstance Win32_Process` tree termination fallback.

### `MH-AUDIT-SEC-006`: Permissive POSIX File Mode Masks on Lock and Temp Files
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/lib/server/runs/repo-lock.ts:204-205`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Repository lock files and temporary atomic JSON files are created without explicit file mode permissions (e.g. `0o600`), relying on host `umask`.
- **Root Cause**: Omitting explicit POSIX mode flags in `writeFile` options.
- **Remediation Rationale**: Pass `{ mode: 0o600 }` on sensitive state file writes.

---

## 5. API & Web UI Layer (`MH-AUDIT-API-xxx`)

### `MH-AUDIT-API-001`: Server SSE Stream Loop Ignores Client Disconnect Signals
- **Status**: `RECLASSIFIED` (Target path updated to `apps/web/src/app/api/runs/[id]/run-events/route.ts`)
- **Target Location**: `apps/web/src/app/api/runs/[id]/run-events/route.ts:31-63`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: SSE stream handler does not listen to `request.signal` abort events. When HTTP connections drop without calling stream `cancel()`, the background polling loop runs indefinitely.
- **Root Cause**: Omitting `request.signal.addEventListener('abort', ...)` listener.
- **Remediation Rationale**: Wire abort listener to set stream `cancelled = true` and clear polling timers.

### `MH-AUDIT-API-002`: Unbounded Client Event Buffer & $O(N^2)$ Refold Overhead
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/lib/client/use-live-run-model.ts:88-120`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Client-side SSE consumer buffers all historical run events in memory and re-executes full state reducer refolding on every incoming event message.
- **Root Cause**: Full-array re-folding on single event push.
- **Remediation Rationale**: Implement incremental state reducer in `useLiveRunModel` that applies delta events to current state snapshot.

### `MH-AUDIT-API-003`: Decision Inspector Card Auto-Activation Failure
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:132`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Selecting a node with a pending human decision in the canvas does not automatically open the `DecisionDetails` inspector card.
- **Root Cause**: Missing state selection trigger in UI component callback.
- **Remediation Rationale**: Wire node click handler to activate decision drawer when node has pending decision.

### `MH-AUDIT-API-004`: In-Memory Web Repository Cache Drifts From Disk Event Store
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/lib/server/runs/repository.ts:140-180`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Web application repository cache keeps run models in memory, drifting from on-disk JSONL event log updates during multi-process CLI runs.
- **Root Cause**: In-memory cache missing file modification timestamp invalidation.
- **Remediation Rationale**: Invalidate in-memory run cache based on event log `mtimeMs` checks.

### `MH-AUDIT-API-005`: Concurrent Decision Resolutions Fail Without HTTP 409
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts:50`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Submitting duplicate human decision resolutions fails silently without returning HTTP 409 Conflict status.
- **Root Cause**: Missing optimistic concurrency check in decision resolution handler.
- **Remediation Rationale**: Return HTTP 409 Conflict if decision was already resolved.

### `MH-AUDIT-API-006`: Unauthenticated API Endpoints Across Web Application
- **Status**: `RECLASSIFIED`
- **Target Location**: `apps/web/src/app/api/**/*.ts` (All 17 API endpoints)
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟢 P3 Low (Local Model)
- **Classification**: `OUT_OF_SCOPE_SAAS` (SaaS Multi-User Auth) / `LOCAL_HARDENING` (Localhost Binding & CSRF) | **Readiness Level**: Level D
- **Description**: Initial audit flagged missing session auth across web API routes. Under ManyHands Local Model, multi-user OAuth is `OUT_OF_SCOPE_SAAS`. The local requirement is strict `127.0.0.1` interface binding and CSRF / Origin header validation.
- **Root Cause**: Evaluating local desktop tool against cloud multi-tenant security requirements.
- **Remediation Rationale**: Enforce `127.0.0.1` binding in Next.js host and validate `Origin` / `Host` headers to prevent local browser CSRF.

### `MH-AUDIT-API-007`: Workspace Path Validation Permits Non-Existent Paths
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/api/workspaces/route.ts:28`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level B
- **Description**: Registering a new workspace accepts arbitrary path strings without verifying filesystem directory existence.
- **Root Cause**: Missing `fs.stat` verification in API route handler.
- **Remediation Rationale**: Validate that provided workspace path exists and is a valid directory.

### `MH-AUDIT-API-008`: Pick Folder Endpoint Native OS Dialog Execution
- **Status**: `RECLASSIFIED`
- **Target Location**: `apps/web/src/app/api/local-fs/pick-folder/route.ts:8-18`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level B
- **Description**: Endpoint triggers native OS GUI file dialog via `pickFolderNative()`. Under local single-user model, native file pickers are legitimate local features, but require origin protection against drive-by web requests.
- **Root Cause**: Unvalidated local endpoint triggering native GUI thread.
- **Remediation Rationale**: Restrict endpoint to local loopback origins with custom CSRF request header.

### `MH-AUDIT-API-009`: Xterm Terminal Addon Memory Leak on Rapid Tab Switching
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/runs/[runId]/_components/terminal-view.client.tsx:40`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Rapidly switching tabs in run view leaves un-disposed `@xterm/addon-fit` event listeners, creating memory leaks.
- **Root Cause**: Missing `addon.dispose()` cleanup in React `useEffect`.
- **Remediation Rationale**: Add explicit `dispose()` cleanup call in terminal component unmount.

### `MH-AUDIT-API-010`: Missing SSE Reconnect Backoff Delay
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/lib/client/use-live-run-model.ts:145`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: On EventSource disconnect, client immediately retries connection without backoff, flooding local web server during server restarts.
- **Root Cause**: Instant reconnect loop in client EventSource error handler.
- **Remediation Rationale**: Implement exponential reconnect backoff delay (1s, 2s, 4s, max 10s).

### `MH-AUDIT-API-011`: Initial SSR Page Load Flashes Empty State
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/runs/[runId]/page.tsx:60`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Page SSR renders empty state before SSE stream connects and populates initial run snapshot data.
- **Root Cause**: Page component omitting initial server-side snapshot hydration data.
- **Remediation Rationale**: Pass initial run snapshot as server prop to hydrate client state immediately.

### `MH-AUDIT-API-013`: Off-Grid CSS Spacing Classes Break Visual Token Consistency
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/(command-center)/_components/cockpit-fixture-view.client.tsx:73`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Non-standard Tailwind class names (`mt-2.5`, `p-5.5`) break visual token grid consistency and cause unit test regex failures in `pnpm test`.
- **Root Cause**: Arbitrary Tailwind value usage.
- **Remediation Rationale**: Replace off-grid spacing values with standard Tailwind design tokens (`mt-2`, `mt-3`, `p-5`, `p-6`).

### `MH-AUDIT-API-014`: Run Cancellation Endpoint Returns 200 OK Before Process Tree Cleanup
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/api/runs/[id]/cancel/route.ts:35`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: `/api/runs/[id]/cancel` sends abort signal and returns HTTP 200 OK immediately before waiting for process supervisor to confirm process tree termination.
- **Root Cause**: Asynchronous fire-and-forget cancellation response.
- **Remediation Rationale**: Await `processSupervisor.killRunProcesses(runId)` barrier before responding.

### `MH-AUDIT-API-015`: Missing WCAG 2.2 Aria-Labels on Drawer Close Buttons
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/runs/[runId]/_components/node-details.client.tsx:80`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Node detail drawer close icon buttons lack accessible `aria-label` tags.
- **Root Cause**: Omitting accessibility attributes on icon-only buttons.
- **Remediation Rationale**: Add `aria-label="Close node details panel"` to drawer close buttons.

### `MH-AUDIT-API-016`: Activity Feed Timestamps Lack Timezone Formatting
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/app/runs/[runId]/_components/activity-feed.client.tsx:50`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Activity log items display raw ISO timestamp strings without localized timezone formatting.
- **Root Cause**: Rendering unformatted date strings.
- **Remediation Rationale**: Format timestamps using `Intl.DateTimeFormat`.

---

## 6. AI Security & Cost Control (`MH-AUDIT-AI-xxx`)

### `MH-AUDIT-AI-001`: Indirect Prompt Injection Vector via Unsanitized Files
- **Status**: `CONFIRMED`
- **Target Location**: `packages/decomposer/src/planner/work-breakdown.ts:112-145`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: Repository code snippets read by `RepositoryIndexer` are interpolated directly into LLM prompt strings without XML escaping envelope tags. Adversarial comments in cloned repositories can inject system prompt overrides.
- **Root Cause**: String interpolation of untrusted codebase text into prompt templates.
- **Remediation Rationale**: Enclose all user file content in strict XML envelope tags (`<user_file_content path="...">`) and sanitize closing tags.

### `MH-AUDIT-AI-002`: Uncapped Token Budget & Unmetered LLM API Invocations
- **Status**: `CONFIRMED`
- **Target Location**: `packages/decomposer/src/llm-decomposer.ts:65-98`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: `LLMDecomposer` executes prompt completion calls without checking per-run `maxBudget` spending limits, allowing runaway API costs on looping decomposition attempts.
- **Root Cause**: Omitting token budget tracking in LLM completion client calls.
- **Remediation Rationale**: Track cumulative input/output token usage in `RunCoordinator` and enforce hard token spending caps.

### `MH-AUDIT-AI-003`: Unrestricted Execution Capabilities in MCP Sidecar Wrappers
- **Status**: `CONFIRMED`
- **Target Location**: `packages/shared/src/sidecar-wrapper.ts:44-78`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: MCP sidecar wrapper tools execute arbitrary shell commands without parameter validation or execution scope checks.
- **Root Cause**: Unrestricted tool execution wrappers.
- **Remediation Rationale**: Implement tool call allowlist and validate arguments against run execution scope.

### `MH-AUDIT-AI-004`: Missing Retry Backoff on Provider Rate Limit HTTP 429 Errors
- **Status**: `CONFIRMED`
- **Target Location**: `packages/decomposer/src/llm-decomposer.ts:140`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: LLM provider API calls failing with HTTP 429 Rate Limit throw immediate unhandled exceptions without exponential backoff retry.
- **Root Cause**: Missing rate-limit error handler wrapper.
- **Remediation Rationale**: Implement exponential backoff retry with jitter on HTTP 429 response codes.

### `MH-AUDIT-AI-005`: Prompt Logs Write Unredacted Sensitive Text to Disk
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/executor/agent-env.ts:80`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level B
- **Description**: Debug prompt logging writes unredacted raw prompt text (including code snippets and potential local API keys) to plain-text log files.
- **Root Cause**: Direct unredacted string logging.
- **Remediation Rationale**: Filter known secret patterns (API keys, tokens) before persisting prompt logs.

### `MH-AUDIT-AI-006`: Structured JSON Output Parsing Relies on Fragile Regex Fallback
- **Status**: `CONFIRMED`
- **Target Location**: `packages/decomposer/src/compiler/graph-compiler.ts:180`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: When LLMs return non-compliant JSON responses, graph compiler attempts regex extraction, which frequently fails on nested markdown code blocks.
- **Root Cause**: Fragile regex fallback for malformed JSON parsing.
- **Remediation Rationale**: Enforce structured JSON mode / tool use schema parameters in LLM requests.

### `MH-AUDIT-AI-007`: High Context Window Overhead From Unpruned AST Dumps
- **Status**: `CONFIRMED`
- **Target Location**: `packages/decomposer/src/planner/work-breakdown.ts:210`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Submitting complete un-pruned AST snapshot dumps to LLMs inflates prompt context window sizes, increasing latency and cost.
- **Root Cause**: Including verbose AST nodes instead of focused symbol outlines.
- **Remediation Rationale**: Prune AST representations to export top-level function/class signatures.

---

## 7. Infrastructure & Supply Chain (`MH-AUDIT-INFRA-xxx`)

### `MH-AUDIT-INFRA-001`: Workspace Specifier Inconsistencies Across Monorepo Manifests
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/package.json:18-28`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level D
- **Description**: Internal monorepo package dependencies use explicit version numbers (`"1.0.0"`) instead of standard pnpm `"workspace:*"` specifiers, breaking local linking during development.
- **Root Cause**: Hardcoded version strings in package manifests.
- **Remediation Rationale**: Standardize all monorepo internal dependencies to `"workspace:*"`.

### `MH-AUDIT-INFRA-002`: Missing Explicit `tsup` devDependency in Package Manifest
- **Status**: `CONFIRMED`
- **Target Location**: `packages/task-graph/package.json:12`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level D
- **Description**: `packages/task-graph/package.json` relies on root `tsup` binary without listing `tsup` in its own `devDependencies`.
- **Root Cause**: Implicit root dependency hoisting assumption.
- **Remediation Rationale**: Add `"tsup": "^8.0.0"` to package `devDependencies`.

### `MH-AUDIT-INFRA-003`: `apps/web/tsconfig.json` Path Overrides Bypass Dist Declarations
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/tsconfig.json:15-30`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level D
- **Description**: Path mappings in `apps/web/tsconfig.json` force TypeScript to compile package `src/*` files directly instead of consuming compiled package `dist/` type declarations.
- **Root Cause**: Direct source file path aliases in web application TSConfig.
- **Remediation Rationale**: Remove direct `src/*` path overrides in `apps/web/tsconfig.json` so web consumes built package declarations.

### `MH-AUDIT-INFRA-004`: Root Build Script Excludes `apps/web`
- **Status**: `CONFIRMED`
- **Target Location**: `package.json:8` (root)
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level D
- **Description**: Root `pnpm build` script executes package builds but omits `apps/web:build`, requiring developers to run separate build commands.
- **Root Cause**: Incomplete root build script pipeline definition.
- **Remediation Rationale**: Update root `pnpm build` script to include web application build.

### `MH-AUDIT-INFRA-005`: Monorepo Uses EOL ESLint v8 Toolchain
- **Status**: `CONFIRMED`
- **Target Location**: `package.json:42` (root)
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Monorepo config uses deprecated ESLint v8 format with legacy `.eslintrc` files instead of ESLint v9 flat config (`eslint.config.js`).
- **Root Cause**: Legacy linter configuration.
- **Remediation Rationale**: Upgrade toolchain to ESLint v9 flat configuration format.

### `MH-AUDIT-INFRA-006`: Phantom Dependency on `ts-morph`
- **Status**: `CONFIRMED`
- **Target Location**: `packages/repository-index/package.json:22`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Code comments in `repository-index` reference `ts-morph` AST parser, but dependency is omitted from `package.json`.
- **Root Cause**: Outdated code comment referencing unused library.
- **Remediation Rationale**: Clean up obsolete comments or add missing type dependency.

### `MH-AUDIT-INFRA-007`: React Type Definition Mismatch (`@types/react@18` vs `react@19`)
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/package.json:35`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level D
- **Description**: `apps/web` specifies `react@19` runtime dependency but specifies `@types/react@18` in devDependencies, generating type check warnings.
- **Root Cause**: Mismatched major version numbers between runtime and type definitions.
- **Remediation Rationale**: Upgrade `@types/react` and `@types/react-dom` to match React 19.

### `MH-AUDIT-INFRA-008`: Missing Frozen Lockfile Verification in CI
- **Status**: `CONFIRMED`
- **Target Location**: `package.json:15` (root)
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `LOCAL_HARDENING` | **Readiness Level**: Level D
- **Description**: CI install steps execute `pnpm install` without `--frozen-lockfile`, allowing lockfile drift across environments.
- **Root Cause**: Omitting strict lockfile enforcement flag in CI scripts.
- **Remediation Rationale**: Pass `--frozen-lockfile` in automated CI installation tasks.

### `MH-AUDIT-INFRA-009`: Inconsistent ECMAScript Compilation Targets Across Packages
- **Status**: `CONFIRMED`
- **Target Location**: `packages/shared/tsconfig.json:5`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Monorepo packages specify varying TSConfig `target` settings (`ES2022` vs `ESNext`).
- **Root Cause**: Un-shared base TSConfig settings.
- **Remediation Rationale**: Standardize target compilation level to `ES2022` in root `tsconfig.base.json`.

### `MH-AUDIT-INFRA-010`: Unused Root `@types/node` Version Mismatch
- **Status**: `CONFIRMED`
- **Target Location**: `package.json:50` (root)
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Root `package.json` specifies `@types/node@18` while sub-packages target Node 20+ APIs.
- **Root Cause**: Legacy root package manifest entry.
- **Remediation Rationale**: Align root `@types/node` version to Node 20 LTS.

---

## 8. QA & Testing Infrastructure (`MH-AUDIT-QA-xxx`)

### `MH-AUDIT-QA-001`: Ephemeral Trace Logging Causes Telemetry Evaporation
- **Status**: `CONFIRMED`
- **Target Location**: `packages/trace-store/src/index.ts:24-60`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level C
- **Description**: Diagnostic trace events are logged exclusively into `InMemoryTraceStore` which is never written to disk, losing diagnostic logs on process exit or crash.
- **Root Cause**: Memory-only trace store implementation.
- **Remediation Rationale**: Implement `JsonlTraceStore` in `packages/trace-store` to persist trace events to disk files (`*.traces.v2.jsonl`).

### `MH-AUDIT-QA-002`: Zero Component/DOM Unit Tests for Web Application
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level D
- **Description**: `apps/web` contains zero React Testing Library unit tests or Playwright E2E browser tests for canvas UI interactions.
- **Root Cause**: Missing web UI test suite setup.
- **Remediation Rationale**: Add Vitest + React Testing Library suite for key web UI components.

### `MH-AUDIT-QA-003`: Fragile UI Tests Rely on Exact Code String Matching
- **Status**: `CONFIRMED`
- **Target Location**: `tests/run-loading-skeleton.test.ts:25`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🔴 P0 Critical
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level D
- **Description**: UI component unit tests read TSX source files as raw text strings via `fs.readFileSync` and check exact class name regexes, failing 2 tests in `pnpm test` when Tailwind formatting changes.
- **Root Cause**: Testing source code formatting strings instead of rendered JSX DOM output.
- **Remediation Rationale**: Refactor tests to render React components using Testing Library and fix Tailwind spacing class tokens in UI components.

### `MH-AUDIT-QA-004`: Missing Package-Level `test` Scripts & Obsolete Vitest Globs
- **Status**: `CONFIRMED`
- **Target Location**: `vitest.config.ts:12` & `packages/*/package.json`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟠 P1 High
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level D
- **Description**: `packages/*/package.json` manifests omit `"test"` scripts, and `vitest.config.ts` uses obsolete glob patterns that skip sub-package integration tests.
- **Root Cause**: Missing package script definitions and outdated Vitest include globs.
- **Remediation Rationale**: Add `"test": "vitest run"` to all package manifests and update root Vitest include patterns.

### `MH-AUDIT-QA-005`: Windows File-Lock Lockouts Cause Integration Test Flakiness
- **Status**: `CONFIRMED`
- **Target Location**: `tests/execution-core-claude-code-cli.test.ts:110`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Integration tests creating and removing temporary worktrees hit Windows file locking delays, relying on global test `retry: 1` workarounds.
- **Root Cause**: Synchronous test cleanup running before process handles release worktree directory locks.
- **Remediation Rationale**: Implement async retry wrapper in test teardown fixtures.

### `MH-AUDIT-QA-006`: Server Error Loggers Suppress Stack Traces
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/lib/server/runs/repository.ts:210`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Server API error loggers log `error.message` strings without printing full error stack traces, complicating local debugging.
- **Root Cause**: Logging string messages instead of error objects.
- **Remediation Rationale**: Print `error.stack` in server error log outputs.

### `MH-AUDIT-QA-007`: Event Store Read Errors Fail Silently
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/jsonl-event-store.ts:190`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Internal filesystem read errors during event store parsing are caught and suppressed without emitting diagnostic trace events.
- **Root Cause**: Empty `catch` blocks in store event parser.
- **Remediation Rationale**: Emit diagnostic trace events whenever event store reads encounter errors.

### `MH-AUDIT-QA-008`: LLM Fallback Tests Rely on Mocks Without Negative Controls
- **Status**: `CONFIRMED`
- **Target Location**: `tests/decomposer-llm-fallback.test.ts:40`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Tests verifying LLM fallback behavior mock successful completions without testing malformed or failing LLM response paths.
- **Root Cause**: Omitting negative test cases in mock test suite.
- **Remediation Rationale**: Add negative test fixtures for malformed LLM responses.

### `MH-AUDIT-QA-009`: Test Execution Reporter Lacks Structured Export Options
- **Status**: `CONFIRMED`
- **Target Location**: `vitest.config.ts:25`
- **Original Severity**: 🟢 P3 Low | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: Vitest configuration uses default console reporter without configuring JUnit or JSON test result export.
- **Root Cause**: Basic test reporter configuration.
- **Remediation Rationale**: Add JSON reporter option to Vitest configuration.

---

## 9. Scalability & Missing Systems (`MH-AUDIT-GAP-xxx`)

### `MH-AUDIT-GAP-001`: Missing Event Store Compaction Subsystem
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/jsonl-event-store.ts:110-160`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Long-running runs accumulate tens of thousands of JSONL events. No compaction or snapshot truncation subsystem exists, increasing startup replay time linearly.
- **Root Cause**: Missing event log pruning mechanism.
- **Remediation Rationale**: Implement event log compaction that truncates historical events prior to verified `RunSnapshot` checkpoints.

### `MH-AUDIT-GAP-002`: Durable Diagnostic Trace Store Missing
- **Status**: `MERGED_DUPLICATE` (Merged into `MH-AUDIT-QA-001`)
- **Target Location**: `packages/trace-store/src/index.ts:24`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: N/A (Duplicate)
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Duplicate finding of `MH-AUDIT-QA-001`. Trace logging is memory-only.
- **Root Cause**: Duplicate domain registration.
- **Remediation Rationale**: Remediated via `MH-AUDIT-QA-001`.

### `MH-AUDIT-GAP-003`: Artifact DAG Cycle Validator Missing
- **Status**: `MERGED_DUPLICATE` (Merged into `MH-AUDIT-ORCH-001`)
- **Target Location**: `packages/task-graph/src/validate-v2.ts:44`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: N/A (Duplicate)
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level A
- **Description**: Duplicate finding of `MH-AUDIT-ORCH-001`. Graph revision validation omits artifact requirement dependency cycles.
- **Root Cause**: Duplicate domain registration.
- **Remediation Rationale**: Remediated via `MH-AUDIT-ORCH-001`.

### `MH-AUDIT-GAP-004`: Multi-Language Repository Indexer (TS/JS Only)
- **Status**: `CONFIRMED`
- **Target Location**: `packages/repository-index/src/snapshot.ts:30`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: AST snapshotting in `RepositoryIndexer` is implemented exclusively for TypeScript/JavaScript, falling back to basic regex symbol extraction for Python, Rust, or Go.
- **Root Cause**: Single-language AST parser implementation.
- **Remediation Rationale**: Add Tree-sitter or multi-language regex parser fallbacks for Python, Go, and Rust.

### `MH-AUDIT-GAP-005`: Incremental Snapshot Delta Folding Unbuilt
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/snapshot-store.ts:60`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level D
- **Description**: `SnapshotStore` recalculates full state snapshot objects from event zero instead of applying state deltas incrementally.
- **Root Cause**: Full-state snapshot projection.
- **Remediation Rationale**: Implement incremental delta applier for snapshot updates.

### `MH-AUDIT-GAP-006`: Worktree & Artifact Garbage Collection Subsystem Uncalled
- **Status**: `MERGED_DUPLICATE` (Merged into `MH-AUDIT-GIT-001`)
- **Target Location**: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:111`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: N/A (Duplicate)
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level B
- **Description**: Duplicate finding of `MH-AUDIT-GIT-001`. Execution pipeline omits `worktrees.gcRun(runId)` cleanup calls on exit.
- **Root Cause**: Duplicate domain registration.
- **Remediation Rationale**: Remediated via `MH-AUDIT-GIT-001`.

### `MH-AUDIT-GAP-007`: Web API Authentication & Middleware Unbuilt
- **Status**: `MERGED_DUPLICATE` (Merged into `MH-AUDIT-API-006`)
- **Target Location**: `apps/web/src/app/api/runs/route.ts:12`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: N/A (Duplicate)
- **Classification**: `OUT_OF_SCOPE_SAAS` / `LOCAL_HARDENING` | **Readiness Level**: Level D
- **Description**: Duplicate finding of `MH-AUDIT-API-006`. Unauthenticated Web API endpoints.
- **Root Cause**: Duplicate domain registration.
- **Remediation Rationale**: Remediated via `MH-AUDIT-API-006`.

### `MH-AUDIT-GAP-008`: $O(N^2)$ Event Store Append Re-Write Loop Under Heavy Loads
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/jsonl-event-store.ts:220-250`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🔴 P0 Critical
- **Classification**: `BLOCKER_LOCAL_PRODUCT` | **Readiness Level**: Level C
- **Description**: `JsonlRunEventStore.append()` reads the complete historical event log file into memory, appends the new event, and re-writes the entire file to disk on every event write, causing severe $O(N^2)$ disk IO degradation.
- **Root Cause**: Read-append-rewrite implementation instead of streaming file append handles.
- **Remediation Rationale**: Refactor `append()` to use true file append streams (`fs.appendFile` or persistent append file handles).

### `MH-AUDIT-GAP-009`: 3x Physical Git Worktree Disk Overhead Per Node Attempt
- **Status**: `CONFIRMED`
- **Target Location**: `packages/execution-core/src/worktree/manager.ts:140-170`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level B
- **Description**: Creating physical worktree clones without shared git object hardlinks consumes ~3x repository disk size per executing node attempt.
- **Root Cause**: Standard `git worktree add` without shared object cache optimization.
- **Remediation Rationale**: Use Git alternate object stores or hardlink options when spawning worktrees.

### `MH-AUDIT-GAP-010`: $O(N^2)$ Pairwise Conflict Risk Matrix Calculation
- **Status**: `CONFIRMED`
- **Target Location**: `packages/conflict-risk/src/analyzer.ts:88-125`
- **Original Severity**: 🟠 P1 High | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: `ConflictRiskAnalyzer` performs exhaustive pairwise file path comparisons across all graph nodes on every wave step.
- **Root Cause**: Naive double-loop file path comparison algorithm.
- **Remediation Rationale**: Index node path scopes in a inverted file-to-node map for $O(1)$ overlap lookups.

### `MH-AUDIT-GAP-011`: Web UI Event Refolding $O(E^2)$ Client Re-Render Overhead
- **Status**: `CONFIRMED`
- **Target Location**: `apps/web/src/lib/client/use-live-run-model.ts:88`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟡 P2 Medium
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY` | **Readiness Level**: Level C
- **Description**: Web client refolds complete event history array on every incoming SSE chunk, freezing UI on large runs.
- **Root Cause**: Full array re-fold in React client state hook.
- **Remediation Rationale**: Apply delta events incrementally to active React state.

### `MH-AUDIT-GAP-012`: Snapshot Store Deserializes Full Blobs Without LRU Cache
- **Status**: `CONFIRMED`
- **Target Location**: `packages/run-store/src/snapshot-store.ts:95`
- **Original Severity**: 🟡 P2 Medium | **Validated Severity**: 🟢 P3 Low
- **Classification**: `OPTIONAL_IMPROVEMENT` | **Readiness Level**: Level C
- **Description**: `RunSnapshotStore.get()` reads and parses full JSON snapshot files from disk on every query without an in-memory LRU cache.
- **Root Cause**: Disk read per snapshot query.
- **Remediation Rationale**: Wrap `RunSnapshotStore.get()` in a 50-item LRU memory cache.
