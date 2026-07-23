# 05 — Master Remediation Backlog Catalog (`MH-REM-001` .. `MH-REM-050`)

**Target System**: ManyHands Monorepo (`apps/web`, `packages/*`)  
**Document Version**: 2.0.0  
**Status**: Formal Specification (Local Product Alignment)  
**Author**: Principal Engineering Review Board (Planning Worker 3)  
**Date**: 2026-07-22  

---

## 1. Master Backlog Summary Table

| ID | Title | Epic | Classification | Level | Priority | Points |
|---|---|---|---|:---:|:---:|:---:|
| `MH-REM-001` | DAG Cycle Validation for ArtifactRequirements | Epic 1: Task Graph | `BLOCKER_LOCAL_PRODUCT` | Level B | P1 | 5 |
| `MH-REM-002` | Wave Selector ConflictConstraints Integration | Epic 1: Task Graph | `BLOCKER_LOCAL_PRODUCT` | Level B | P1 | 5 |
| `MH-REM-003` | V2ExecutionDriver Promise Mutation Race Fix | Epic 1: Task Graph | `BLOCKER_LOCAL_PRODUCT` | Level B | P1 | 3 |
| `MH-REM-004` | Scope Isolation Critic Calibration | Epic 1: Task Graph | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P1 | 3 |
| `MH-REM-005` | Canonical Typed Relations & SeamBinding Schema | Epic 1: Task Graph | `BLOCKER_LOCAL_PRODUCT` | Level B | P2 | 3 |
| `MH-REM-006` | Compare-and-Swap (CAS) GraphRevision Reducer | Epic 1: Task Graph | `BLOCKER_LOCAL_PRODUCT` | Level B | P2 | 5 |
| `MH-REM-007` | Dirty Workspace Check in GroundingAgent | Epic 2: Worktree Security | `BLOCKER_LOCAL_PRODUCT` | Level B | P0 | 5 |
| `MH-REM-008` | Path Normalization & Scope Traversal Guard | Epic 2: Worktree Security | `BLOCKER_LOCAL_PRODUCT` | Level B | P1 | 5 |
| `MH-REM-009` | Supervised Process Spawning & Secret Filtering | Epic 2: Worktree Security | `BLOCKER_LOCAL_PRODUCT` | Level B | P1 | 5 |
| `MH-REM-010` | Automatic Worktree & Branch Garbage Collector | Epic 2: Worktree Security | `BLOCKER_LOCAL_PRODUCT` | Level B | P1 | 5 |
| `MH-REM-011` | Jittered Exponential Backoff for Git Index Lock | Epic 2: Worktree Security | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P1 | 3 |
| `MH-REM-012` | Explicit Fallback Git Committer Identity | Epic 2: Worktree Security | `LOCAL_HARDENING` | Level B | P1 | 3 |
| `MH-REM-013` | Host Worktree Resource Limit & Isolation Policy | Epic 2: Worktree Security | `LOCAL_HARDENING` | Level D | P2 | 5 |
| `MH-REM-014` | Lock Ownership Fencing in acquireDurableLock | Epic 3: Persistence Engine | `BLOCKER_LOCAL_PRODUCT` | Level B | P0 | 5 |
| `MH-REM-015` | fsync Flushes & Jittered Delay in Atomic Writes | Epic 3: Persistence Engine | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P1 | 3 |
| `MH-REM-016` | JsonlAttemptStore update() State Transition Method | Epic 3: Persistence Engine | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P1 | 3 |
| `MH-REM-017` | Event Store Compaction & Snapshot Truncation | Epic 3: Persistence Engine | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P1 | 5 |
| `MH-REM-018` | High-Throughput Stream Writer for Event Store | Epic 3: Persistence Engine | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P1 | 5 |
| `MH-REM-019` | Durable JsonlTraceStore Telemetry Persistence | Epic 3: Persistence Engine | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P1 | 5 |
| `MH-REM-020` | Persistence Crash Recovery & Integrity Verifier | Epic 3: Persistence Engine | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P2 | 3 |
| `MH-REM-021` | Declared Artifact ExecutionBase Materializer | Epic 4: Execution Core | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P1 | 5 |
| `MH-REM-022` | Node-Local InputFingerprint Calculator & Rejection | Epic 4: Execution Core | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P1 | 5 |
| `MH-REM-023` | Worktree Git Object Hardlink Disk Optimization | Epic 4: Execution Core | `LOCAL_HARDENING` | Level B | P2 | 3 |
| `MH-REM-024` | Stale Node Attempt Event Notification System | Epic 4: Execution Core | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P2 | 3 |
| `MH-REM-025` | Execution Base Manifest Generator | Epic 4: Execution Core | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P2 | 3 |
| `MH-REM-026` | Immutable Attempt Checksum Verification | Epic 4: Execution Core | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P2 | 3 |
| `MH-REM-027` | SSE Request Abort Signal Server Teardown | Epic 5: API & Web UI | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P1 | 5 |
| `MH-REM-028` | Localhost API Route Guard & CSRF Verification | Epic 5: API & Web UI | `LOCAL_HARDENING` | Level C | P1 | 5 |
| `MH-REM-029` | Protected Native Folder Picker Confirmation | Epic 5: API & Web UI | `LOCAL_HARDENING` | Level C | P1 | 3 |
| `MH-REM-030` | Client Incremental Event Fold & Reconnect Checkpoints | Epic 5: API & Web UI | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P1 | 5 |
| `MH-REM-031` | Web Cockpit Off-Grid Tailwind Spacing Fix | Epic 5: API & Web UI | `OPTIONAL_IMPROVEMENT` | Level C | P2 | 3 |
| `MH-REM-032` | Non-Auto-Recentering Canvas Viewport Policy | Epic 5: API & Web UI | `LOCAL_HARDENING` | Level C | P2 | 3 |
| `MH-REM-033` | WCAG 2.2 AA Keyboard Navigation & Reduced Motion | Epic 5: API & Web UI | `LOCAL_HARDENING` | Level D | P2 | 3 |
| `MH-REM-034` | XML Prompt Envelope Isolation for Untrusted Content | Epic 6: AI Security | `LOCAL_HARDENING` | Level D | P1 | 5 |
| `MH-REM-035` | Pre-Execution Token Budget Spending Caps | Epic 6: AI Security | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level D | P1 | 5 |
| `MH-REM-036` | Local Sidecar Tool Execution Capability Sandbox | Epic 6: AI Security | `LOCAL_HARDENING` | Level D | P1 | 5 |
| `MH-REM-037` | Prompt Injection Escaping & Delimiter Sanitizer | Epic 6: AI Security | `LOCAL_HARDENING` | Level D | P2 | 3 |
| `MH-REM-038` | Per-Agent Token Cost Attribution Logging | Epic 6: AI Security | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level D | P2 | 3 |
| `MH-REM-039` | Local Model Fallback Router for API Outages | Epic 6: AI Security | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level D | P2 | 4 |
| `MH-REM-040` | Standardize Monorepo Workspace Specifiers | Epic 7: Infrastructure | `BLOCKER_LOCAL_PRODUCT` | Level D | P2 | 3 |
| `MH-REM-041` | Local Dependency Build Integrity Verification | Epic 7: Infrastructure | `BLOCKER_LOCAL_PRODUCT` | Level D | P2 | 3 |
| `MH-REM-042` | Clean Local Setup & Startup Launcher (`agy start`) | Epic 7: Infrastructure | `BLOCKER_LOCAL_PRODUCT` | Level D | P3 | 3 |
| `MH-REM-043` | Local Environment API Key Validator | Epic 7: Infrastructure | `BLOCKER_LOCAL_PRODUCT` | Level D | P2 | 3 |
| `MH-REM-044` | Vitest Configuration & Package Script Standardization | Epic 7: Infrastructure | `BLOCKER_LOCAL_PRODUCT` | Level D | P3 | 3 |
| `MH-REM-045` | React Testing Library DOM Component Tests | Epic 8: QA & Testing | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P2 | 3 |
| `MH-REM-046` | Playwright E2E Browser Test Suite for Local Web | Epic 8: QA & Testing | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P1 | 5 |
| `MH-REM-047` | Package-Level Test Scripts & Vitest Discovery Globs | Epic 8: QA & Testing | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level C | P2 | 3 |
| `MH-REM-048` | Worktree Lifecycle & Concurrency Integration Suite | Epic 8: QA & Testing | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P1 | 5 |
| `MH-REM-049` | Synthetic Task Graph Wave Selector Stress Tests | Epic 8: QA & Testing | `REQUIRED_FOR_LOCAL_RELIABILITY` | Level B | P2 | 4 |
| `MH-REM-050` | Local Diagnostic Trace Reader CLI & Web Component | Epic 8: QA & Testing | `LOCAL_HARDENING` | Level C | P3 | 3 |

---

## 2. Granular Remediation Item Catalog (`MH-REM-001` .. `MH-REM-050`)

---

### Epic 1: Task Graph & Canonical Relations Contract Engine

#### `MH-REM-001`: Implement Kahn's Algorithm DAG Cycle Validation for ArtifactRequirements
- **Epic**: Epic 1: Task Graph & Canonical Relations Contract Engine
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-ORCH-001`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/task-graph/src/validate-v2.ts`, `packages/task-graph/src/types-v2.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - `validateGraphRevision` MUST build an adjacency matrix including both `parentId` structural edges and `ArtifactRequirement` consumer-producer edges.
  - The validator MUST execute Kahn's topological sort algorithm over the combined graph.
  - If unvisited nodes remain after Kahn's algorithm execution, `validateGraphRevision` MUST return `valid: false` with error message `"Cyclic dependency detected in task graph involving artifact requirements"` and list the cyclic node IDs.
  - Automated test `tests/task-graph-artifact-cycles.test.ts` MUST pass, verifying that circular artifact requirements (e.g. Node A -> Node B -> Node A) are rejected before execution starts.

#### `MH-REM-002`: Integrate GraphRevision ConflictConstraints into Wave Selection
- **Epic**: Epic 1: Task Graph & Canonical Relations Contract Engine
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-ORCH-002`
- **Technical Dependencies**: `MH-REM-001`
- **Target Files / Packages**: `packages/scheduler/src/wave-selector-v2.ts`, `packages/conflict-risk/src/analyzer.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - `selectReadyWaveV2` MUST read `ConflictConstraint` edges from the active `GraphRevision`.
  - Candidate ready nodes MUST be evaluated against currently running wave nodes using `ConflictRiskAnalyzer`.
  - If candidate Node B has an active `ConflictConstraint` with running Node A, Node B MUST be excluded from the current execution wave and deferred to the next wave.
  - Automated test `tests/scheduler-conflict-constraints.test.ts` MUST pass, proving conflicting nodes never run in parallel.

#### `MH-REM-003`: Remediate V2ExecutionDriver Promise Mutation Concurrency Race
- **Epic**: Epic 1: Task Graph & Canonical Relations Contract Engine
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-ORCH-003`
- **Technical Dependencies**: `MH-REM-001`, `MH-REM-002`
- **Target Files / Packages**: `packages/orchestrator-graph/src/v2/execution-driver.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Refactor `V2ExecutionDriver` to eliminate in-place array/map mutation of active node execution promise drivers.
  - Execution state updates MUST process through an immutable compare-and-swap (CAS) reducer callback.
  - Parallel node completions executing concurrently MUST update run status atomically without dropping completed node state.
  - Automated test `tests/execution-driver-concurrency.test.ts` MUST verify 10 concurrent node completions complete without race condition errors.

#### `MH-REM-004`: Calibrate Scope Isolation Critic to Prevent False Positive Rejections
- **Epic**: Epic 1: Task Graph & Canonical Relations Contract Engine
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-ORCH-004`
- **Technical Dependencies**: `MH-REM-001`
- **Target Files / Packages**: `packages/decomposer/src/critics/scope-critic.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Update `ScopeCritic` evaluation logic to distinguish between declared file edits and valid shared module imports.
  - File modifications strictly contained within the node's declared `ScopeContract` file list MUST NOT be rejected.
  - Automated unit tests MUST confirm valid leaf node edits are approved while cross-boundary edits outside scope remain blocked.

#### `MH-REM-005`: Define Canonical Typed Relations & SeamBinding Schema Contracts
- **Epic**: Epic 1: Task Graph & Canonical Relations Contract Engine
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: None (Architecture Standardization)
- **Technical Dependencies**: `MH-REM-001`
- **Target Files / Packages**: `packages/task-graph/src/types-v2.ts`, `packages/contracts/src/relations.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Define TypeScript `RelationType` union: `'parentId' | 'ArtifactRequirement' | 'SeamBinding' | 'ConflictConstraint'`.
  - Implement Zod schema validation for all 4 edge types in `packages/contracts`.
  - Export contract validation utilities verifying relation targets exist within the current `GraphRevision`.

#### `MH-REM-006`: Implement Compare-and-Swap (CAS) GraphRevision Reduction Engine
- **Epic**: Epic 1: Task Graph & Canonical Relations Contract Engine
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: None (Architecture Standardization)
- **Technical Dependencies**: `MH-REM-005`
- **Target Files / Packages**: `packages/task-graph/src/graph-reducer.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Implement `reduceGraphRevision(currentRev, action)` returning a newly instantiated, immutable `GraphRevision` object.
  - Every reduction MUST increment `revisionId` (e.g. `rev_0001` -> `rev_0002`) and set `parentRevisionId`.
  - In-place object mutations on existing `GraphRevision` instances MUST be frozen (`Object.freeze`).

---

### Epic 2: Worktree Security, Process Supervision & Host Sandboxing

#### `MH-REM-007`: Implement Dirty Workspace Verification Guard in GroundingAgent
- **Epic**: Epic 2: Worktree Security, Process Supervision & Host Sandboxing
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P0 (Critical)**
- **Related Audit Findings**: `MH-AUDIT-GIT-010`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/execution-core/src/run/grounding-agent.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - `GroundingAgent.run` MUST invoke `git.statusPorcelain(params.repoRoot)` before creating walking skeleton files.
  - If uncommitted or untracked files are returned by `statusPorcelain`, `GroundingAgent` MUST NOT call `git.addAllExcluding` on `params.repoRoot`.
  - In dirty workspaces, `GroundingAgent` MUST either abort execution with `HostDirtyWorkspaceError` or create the walking skeleton inside an isolated temporary Git worktree.
  - Automated test `tests/git-dirty-workspace-grounding.test.ts` MUST verify user uncommitted files remain untouched and untracked.

#### `MH-REM-008`: Implement Path Normalization and Scope Traversal Guard
- **Epic**: Epic 2: Worktree Security, Process Supervision & Host Sandboxing
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-SEC-002`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/execution-core/src/scope/checker.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - `ScopeChecker.validatePath` MUST resolve all target paths using `path.resolve(worktreeRoot, targetPath)`.
  - Normalized paths MUST be checked using `resolvedTarget.startsWith(worktreeRoot + path.sep) || resolvedTarget === worktreeRoot`.
  - Path traversal attempts containing `../` escaping the worktree root MUST throw `ScopeViolationError` immediately.
  - Automated test `tests/scope-path-traversal.test.ts` MUST verify attempts to access `../../etc/passwd` or external directories are blocked.

#### `MH-REM-009`: Implement Supervised Process Spawning & Secret Environment Sanitization
- **Epic**: Epic 2: Worktree Security, Process Supervision & Host Sandboxing
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-SEC-001`
- **Technical Dependencies**: None
- **Target Files / Packages**: `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`, `packages/execution-core/src/git/supervised-process-manager.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Replace raw `child_process.spawn(..., { env: process.env })` in `run-coordinator-host.ts` with `buildAgentEnvironment()` filtered environment keys.
  - Child processes MUST be registered with `LiveProcessRegistry` upon spawn.
  - Upon run termination or cancellation, `LiveProcessRegistry.terminateAllForRun(runId)` MUST send SIGTERM (followed by SIGKILL after 2s) to all registered process PIDs.
  - Automated test `tests/security-planning-env.test.ts` MUST verify environment secrets are not leaked to sub-processes and process registry termination works cleanly.

#### `MH-REM-010`: Implement Automatic Worktree and Temporary Branch Lifecycle Garbage Collection
- **Epic**: Epic 2: Worktree Security, Process Supervision & Host Sandboxing
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-GIT-001`
- **Technical Dependencies**: `MH-REM-007`
- **Target Files / Packages**: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts`, `packages/execution-core/src/worktree/manager.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Wrap execution pipeline runs in a try-finally block where `finally` executes `worktreeManager.cleanupRunWorktrees(runId)`.
  - Temporary Git worktree directories (`.manyhands/worktrees/<attemptId>`) MUST be pruned via `git worktree remove --force`.
  - Temporary attempt Git branches MUST be deleted via `git branch -D`.
  - Automated test `tests/git-worktree-cleanup.test.ts` MUST verify zero orphaned worktree directories or temporary branches remain on run completion or error exit.

#### `MH-REM-011`: Implement Jittered Exponential Backoff Retry for Git Index Lock Contention
- **Epic**: Epic 2: Worktree Security, Process Supervision & Host Sandboxing
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-GIT-005`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/execution-core/src/git/runner.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - `SimpleGitRunner` operations encountering `.git/index.lock` lock error MUST execute retry loop.
  - Retry delays MUST use exponential backoff with random jitter (base 100ms, multiplier 2x, max 5 retries, max delay 2000ms).
  - Operations failing after 5 retries MUST fail with clear `GitIndexLockContentionError`.
  - Automated test `tests/git-index-lock-retry.test.ts` MUST verify concurrent Git operations succeed despite temporary index lock contention.

#### `MH-REM-012`: Enforce Explicit Fallback Git Committer Identity in SimpleGitRunner
- **Epic**: Epic 2: Worktree Security, Process Supervision & Host Sandboxing
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-GIT-007`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/execution-core/src/git/runner.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - `SimpleGitRunner` MUST check local and global Git user config (`user.name`, `user.email`).
  - If Git user identity is unconfigured on host, `SimpleGitRunner` MUST set fallback identity: `user.name = "ManyHands Bot"` and `user.email = "bot@manyhands.dev"`.
  - Git commit calls MUST succeed without failing on unconfigured local developer machines.

#### `MH-REM-013`: Host Worktree Resource Limit & Isolation Policy
- **Epic**: Epic 2: Worktree Security, Process Supervision & Host Sandboxing
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Architecture Specification
- **Technical Dependencies**: `MH-REM-009`, `MH-REM-010`
- **Target Files / Packages**: `packages/execution-core/src/worktree/isolation-policy.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Implement host worktree isolation policy enforcing maximum concurrent sub-processes (default: CPU core count - 1).
  - Disallow execution of administrative/root commands (`sudo`, `chmod 777 /`, system format).
  - Verify all spawned agent sub-processes execute under current unprivileged local user context.

---

### Epic 3: Persistence Engine & Atomic Event Store Recovery

#### `MH-REM-014`: Implement Lock Ownership Fencing in acquireDurableLock
- **Epic**: Epic 3: Persistence Engine & Atomic Event Store Recovery
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P0 (Critical)**
- **Related Audit Findings**: `MH-AUDIT-PERS-001`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/run-store/src/jsonl-event-store.ts`, `packages/run-store/src/durable-lock.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - `acquireDurableLock` MUST generate a unique UUID v4 lock token and write `owner.json` `{ pid: number, acquiredAt: string, lockToken: string }` inside `lockPath`.
  - The release callback MUST read `owner.json` before unlinking `lockPath`.
  - If `owner.json` token does NOT match the acquiring process's token, release callback MUST NOT delete the directory and MUST log warning.
  - Automated test `tests/run-store-lock-ownership.test.ts` MUST verify that process A's delayed release callback never deletes process B's taken-over lock directory.

#### `MH-REM-015`: Implement fsync Flushes & Jittered Delay in Atomic Writes
- **Epic**: Epic 3: Persistence Engine & Atomic Event Store Recovery
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-PERS-002`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/run-store/src/jsonl-event-store.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - `atomicWrite` MUST open a unique temporary file (`file.tmp.<uuid>`), write content, and execute `fs.fsync(fd)` before closing.
  - Rename retries on `EBUSY`/`EPERM` MUST execute with exponential backoff and random jitter (10ms, 20ms, 40ms, max 5 retries).
  - Unused `.tmp` files MUST be unlinked in a `finally` block on failure.
  - Automated test `tests/atomic-write-fsync.test.ts` MUST verify zero file corruption or leaked `.tmp` files during concurrent write stress.

#### `MH-REM-016`: Implement JsonlAttemptStore update() State Transition Method
- **Epic**: Epic 3: Persistence Engine & Atomic Event Store Recovery
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-PERS-006`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/run-store/src/attempt-store.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Add `update(attemptId: string, patchFn: (current: NodeAttempt) => NodeAttempt): Promise<NodeAttempt>` method to `JsonlAttemptStore`.
  - The method MUST read current attempt state, apply `patchFn`, and atomically persist updated attempt state.
  - Attempt state updates (e.g. `pending` -> `running` -> `succeeded` / `failed`) MUST succeed deterministically.

#### `MH-REM-017`: Implement Event Store Compaction & Snapshot Truncation Subsystem
- **Epic**: Epic 3: Persistence Engine & Atomic Event Store Recovery
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-GAP-001`
- **Technical Dependencies**: `MH-REM-014`, `MH-REM-015`
- **Target Files / Packages**: `packages/run-store/src/compactor.ts`, `packages/run-store/src/jsonl-event-store.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Implement `EventStoreCompactor` executing when run event log exceeds 1,000 events.
  - Compactor MUST compute verified `RunSnapshot`, write `snapshot.json`, and truncate historical JSONL events prior to snapshot checkpoint.
  - Replaying run state after compaction MUST produce identical `RunModel` state in fraction of time.
  - Automated test `tests/run-store-compaction.test.ts` MUST verify 10,000 events are compacted cleanly without state loss.

#### `MH-REM-018`: Refactor High-Throughput Stream Writer for Event Store
- **Epic**: Epic 3: Persistence Engine & Atomic Event Store Recovery
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-GAP-008`
- **Technical Dependencies**: `MH-REM-015`
- **Target Files / Packages**: `packages/run-store/src/jsonl-event-store.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Replace full file re-write append loop in `JsonlRunEventStore.append()` with true append stream (`fs.createWriteStream(..., { flags: 'a' })`).
  - Event appends MUST execute in $O(1)$ constant time regardless of event log file size.
  - Event append throughput under heavy load MUST achieve >= 5,000 events/sec.

#### `MH-REM-019`: Implement Durable JsonlTraceStore for Diagnostic Telemetry
- **Epic**: Epic 3: Persistence Engine & Atomic Event Store Recovery
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-PERS-004`, `MH-AUDIT-QA-001`
- **Technical Dependencies**: `MH-REM-015`
- **Target Files / Packages**: `packages/trace-store/src/jsonl-trace-store.ts`, `packages/trace-store/src/index.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Replace `InMemoryTraceStore` with durable `JsonlTraceStore` writing telemetry to `.manyhands/runs/<runId>/traces.jsonl`.
  - Diagnostic trace events (logs, tool execution, spans) MUST survive process restarts and crashes.
  - Automated test `tests/trace-store-durability.test.ts` MUST verify logged traces are readable from disk store after process restart.

#### `MH-REM-020`: Implement Persistence Crash Recovery & Integrity Verifier Routine
- **Epic**: Epic 3: Persistence Engine & Atomic Event Store Recovery
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Architecture Specification
- **Technical Dependencies**: `MH-REM-017`, `MH-REM-018`
- **Target Files / Packages**: `packages/run-store/src/recovery.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Implement `verifyAndRecoverRunStore(runId)` checking JSONL formatting and CRC checksums.
  - Truncated or corrupted last lines (due to abrupt power loss) MUST be repaired gracefully by dropping incomplete trailing bytes.
  - State replay MUST reconstruct latest valid state snapshot without throwing syntax errors.

---

### Epic 4: Execution Core, Base Materialization & Input Fingerprinting

#### `MH-REM-021`: Implement Declared Artifact ExecutionBase Materializer
- **Epic**: Epic 4: Execution Core, Base Materialization & Input Fingerprinting
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-ORCH-003`
- **Technical Dependencies**: `MH-REM-007`
- **Target Files / Packages**: `packages/execution-core/src/base/builder.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - `ExecutionBaseBuilder` MUST construct attempt workspace by checking out baseline Git commit and applying ONLY explicitly declared `ArtifactRequirement` commits.
  - Sibling commits or undeclared node outputs MUST NOT be merged into the execution base.
  - Materialized execution base directory MUST contain exact files specified by contracts.

#### `MH-REM-022`: Implement Node-Local InputFingerprint Calculator & Rejection Engine
- **Epic**: Epic 4: Execution Core, Base Materialization & Input Fingerprinting
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-ORCH-004`
- **Technical Dependencies**: `MH-REM-021`
- **Target Files / Packages**: `packages/execution-core/src/fingerprint.ts`, `packages/orchestrator-graph/src/v2/attempt-adopter.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - `computeInputFingerprint` MUST hash node ID, scope contract hash, validation contract hash, base commit hash, artifact SHA-256 map, and executor profile ID.
  - The calculation MUST EXCLUDE the global `GraphRevision` ID.
  - `RunCoordinator` MUST compare attempt `InputFingerprint` against active node requirements upon completion and reject stale attempts.

#### `MH-REM-023`: Optimize Worktree Git Object Hardlink Disk Footprint
- **Epic**: Epic 4: Execution Core, Base Materialization & Input Fingerprinting
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: `MH-AUDIT-GAP-009`
- **Technical Dependencies**: `MH-REM-010`
- **Target Files / Packages**: `packages/execution-core/src/worktree/manager.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Configure Git worktree creation to share local Git object storage via `.git/objects/info/alternates`.
  - Physical disk overhead per node attempt worktree MUST be reduced by >= 80% compared to full clone copies.

#### `MH-REM-024`: Implement Stale Node Attempt Event Notification System
- **Epic**: Epic 4: Execution Core, Base Materialization & Input Fingerprinting
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Architecture Specification
- **Technical Dependencies**: `MH-REM-022`
- **Target Files / Packages**: `packages/orchestrator-graph/src/v2/attempt-adopter.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - When an attempt is rejected due to fingerprint mismatch, emit `NodeAttemptStaleEvent`.
  - The node state MUST transition to `re-queued` for automatic re-execution with updated execution base.

#### `MH-REM-025`: Implement Materialized Base Manifest Generator
- **Epic**: Epic 4: Execution Core, Base Materialization & Input Fingerprinting
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Architecture Specification
- **Technical Dependencies**: `MH-REM-021`
- **Target Files / Packages**: `packages/execution-core/src/base/manifest.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Write `execution-base-manifest.json` inside attempt worktree recording base commit hash, applied artifact versions, sha256 checksums, and creation timestamp.
  - Manifest MUST be attached to attempt completion payload for audit verification.

#### `MH-REM-026`: Enforce Immutable Attempt Checksum Verification
- **Epic**: Epic 4: Execution Core, Base Materialization & Input Fingerprinting
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Architecture Specification
- **Technical Dependencies**: `MH-REM-025`
- **Target Files / Packages**: `packages/execution-core/src/run/checksum-verifier.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Calculate SHA-256 hash over completed attempt output diffs and materialized files.
  - Attempt record store MUST verify checksum matches manifest before marking attempt `succeeded`.

---

### Epic 5: API, SSE & Web UI Local State Synchronization

#### `MH-REM-027`: Wire SSE Request Abort Signal Server Teardown
- **Epic**: Epic 5: API, SSE & Web UI Local State Synchronization
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-API-001`
- **Technical Dependencies**: None
- **Target Files / Packages**: `apps/web/src/app/api/runs/[runId]/events/route.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Attach `request.signal.addEventListener('abort', ...)` inside the SSE stream route.
  - Upon client disconnect, immediately cancel background event store polling timer and unsubscribe listener within 100ms.
  - Automated test `tests/api-sse-disconnect.test.ts` MUST verify zero background timers remain active after stream abort.

#### `MH-REM-028`: Enforce Localhost API Route Guard & CSRF Verification
- **Epic**: Epic 5: API, SSE & Web UI Local State Synchronization
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-API-006` (Localhost Guard)
- **Technical Dependencies**: None
- **Target Files / Packages**: `apps/web/src/middleware.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Implement Next.js middleware restricting API requests exclusively to local loopback addresses (`127.0.0.1`, `::1`).
  - Mutating HTTP requests (POST, PUT, DELETE) MUST verify `Origin` / `Host` headers match `localhost` or `127.0.0.1`.
  - Non-local network requests MUST be rejected with HTTP 403 Forbidden.

#### `MH-REM-029`: Secure Protected Native Folder Picker Confirmation
- **Epic**: Epic 5: API, SSE & Web UI Local State Synchronization
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-API-008`
- **Technical Dependencies**: `MH-REM-028`
- **Target Files / Packages**: `apps/web/src/app/api/local-fs/pick-folder/route.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - `pick-folder` route MUST require a valid local confirmation token generated by the local web UI session.
  - Unauthenticated or external requests trying to trigger native file dialogs MUST be rejected immediately without spawning OS dialogs.

#### `MH-REM-030`: Implement Client Incremental Event Fold & Reconnect Checkpoints
- **Epic**: Epic 5: API, SSE & Web UI Local State Synchronization
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-API-002`
- **Technical Dependencies**: `MH-REM-027`
- **Target Files / Packages**: `apps/web/src/lib/client/use-live-run-model.ts`, `apps/web/src/lib/run-model/state-folder.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Refactor `useLiveRunModel` to store a cached `RunSnapshot` and a bounded event buffer (max 500 recent events).
  - Incoming SSE events MUST be folded incrementally into state projection without re-folding from event 0.
  - Reconnection requests MUST send `Last-Event-ID` header to resume stream without full log re-fetch.
  - Web UI state updates MUST maintain 60fps responsiveness during high event throughput.

#### `MH-REM-031`: Fix Web Cockpit Off-Grid Tailwind Spacing Classes
- **Epic**: Epic 5: API, SSE & Web UI Local State Synchronization
- **Classification**: `OPTIONAL_IMPROVEMENT`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: `MH-AUDIT-QA-003`
- **Technical Dependencies**: None
- **Target Files / Packages**: `apps/web/src/components/cockpit-fixture-view.client.tsx`, `apps/web/src/components/run-model-view.client.tsx`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Replace off-grid custom CSS spacing classes in cockpit component views with standard Tailwind grid/spacing utilities.
  - Fix component visual alignment across breakpoints.
  - All existing `pnpm test` UI component tests MUST pass cleanly.

#### `MH-REM-032`: Enforce Non-Auto-Recentering Canvas Viewport Policy
- **Epic**: Epic 5: API, SSE & Web UI Local State Synchronization
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Product Rule A17 Compliance
- **Technical Dependencies**: `MH-REM-030`
- **Target Files / Packages**: `apps/web/src/components/graph-canvas.client.tsx`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Disable automatic `fitView()`, auto-pan, or auto-zoom calls in response to incoming SSE run events.
  - Canvas viewport state (pan position, zoom level) MUST remain unchanged during background graph updates.
  - Viewport auto-recenter MUST occur ONLY when user clicks the manual "Recenter View" button.

#### `MH-REM-033`: Implement WCAG 2.2 AA Keyboard Navigation & Reduced Motion
- **Epic**: Epic 5: API, SSE & Web UI Local State Synchronization
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Product Accessibility Standard
- **Technical Dependencies**: `MH-REM-031`
- **Target Files / Packages**: `apps/web/src/app/`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Ensure 100% keyboard accessibility across all interactive Web UI elements (Tab, Enter, Space, Escape).
  - Add visible focus rings (`focus-visible:ring-2`) on all clickable buttons and canvas nodes.
  - Support `prefers-reduced-motion` media queries disabling non-essential canvas animations.

---

### Epic 6: AI Security, Prompt Protection & Token Governance

#### `MH-REM-034`: Implement XML Prompt Envelope Isolation for Untrusted Content
- **Epic**: Epic 6: AI Security, Prompt Protection & Token Governance
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-AI-001`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/decomposer/src/planner/work-breakdown.ts`, `packages/decomposer/src/planner/prompt-envelope.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - All user repository code snippets, issue texts, and external files interpolated into LLM prompts MUST be wrapped in `<user_repository_file path="...">` XML tags.
  - Inner occurrences of `</user_repository_file>` MUST be escaped to `&lt;/user_repository_file&gt;`.
  - System prompts MUST instruct model that text inside `<user_repository_file>` is untrusted data.
  - Automated test `tests/ai-prompt-injection.test.ts` MUST verify prompt injection payloads inside source files are rendered inert.

#### `MH-REM-035`: Implement Pre-Execution Token Budget Spending Caps
- **Epic**: Epic 6: AI Security, Prompt Protection & Token Governance
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-AI-002`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/decomposer/src/llm-decomposer.ts`, `packages/shared/src/token-budget.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - `TokenBudgetLedger` MUST track cumulative prompt and completion token expenditures per run.
  - Before executing any LLM call, `LLMDecomposer` MUST check remaining budget against `maxBudgetUsd` spending cap.
  - If budget cap is exceeded, call MUST abort with `TokenBudgetExceededError` before invoking LLM API.
  - Automated test `tests/ai-budget-limits.test.ts` MUST verify calls abort when budget is exhausted.

#### `MH-REM-036`: Restrict Local Sidecar Tool Execution Capabilities & Schema Validation
- **Epic**: Epic 6: AI Security, Prompt Protection & Token Governance
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-AI-003`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/shared/src/sidecar-wrapper.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Sidecar MCP tool wrappers MUST validate incoming tool parameters against explicit Zod JSON schemas.
  - Tool execution MUST enforce allowlists restricting tool actions to safe, permitted local capabilities.
  - Execution attempts with invalid parameters or unpermitted tools MUST be rejected with `UnpermittedToolCapabilityError`.

#### `MH-REM-037`: Implement Prompt Injection Escaping & Delimiter Sanitizer
- **Epic**: Epic 6: AI Security, Prompt Protection & Token Governance
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Architecture Security Standard
- **Technical Dependencies**: `MH-REM-034`
- **Target Files / Packages**: `packages/decomposer/src/planner/prompt-sanitizer.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Implement regex sanitizer stripping adversarial system override framing phrases (`"Ignore previous instructions"`, `"System prompt override"`).
  - Sanitizer MUST sanitize input prior to prompt template rendering.

#### `MH-REM-038`: Implement Per-Agent Token Cost Attribution Logging
- **Epic**: Epic 6: AI Security, Prompt Protection & Token Governance
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Cost Transparency Standard
- **Technical Dependencies**: `MH-REM-035`
- **Target Files / Packages**: `packages/shared/src/token-budget.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Record input token count, output token count, estimated USD cost, and model name in every `AgentInvocationCompletedEvent`.
  - Expose summary token spending report via CLI (`agy run cost <runId>`).

#### `MH-REM-039`: Implement Local Model Fallback Router for API Outages
- **Epic**: Epic 6: AI Security, Prompt Protection & Token Governance
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Resilience Architecture
- **Technical Dependencies**: `MH-REM-035`
- **Target Files / Packages**: `packages/decomposer/src/llm-router.ts`
- **Estimate / Complexity**: 4 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Implement LLM Provider Fallback Router (e.g. Primary: Anthropic Claude 3.5 -> Secondary: OpenAI GPT-4o -> Local: Ollama/vLLM).
  - Upon HTTP 429 Rate Limit or 5xx API error, router MUST automatically failover to secondary provider without failing active run.

---

### Epic 7: Infrastructure, Supply Chain & Build Hardening

#### `MH-REM-040`: Standardize Internal Monorepo Package Dependencies to workspace:*
- **Epic**: Epic 7: Infrastructure, Supply Chain & Build Hardening
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: `MH-AUDIT-INFRA-001`
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/*/package.json`, `apps/web/package.json`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Update all internal monorepo package dependencies in `package.json` files to use `"workspace:*"`.
  - Eliminate fixed version strings (e.g. `"1.0.0"`) for internal `@manyhands/*` packages.
  - `pnpm install` MUST run cleanly with zero workspace version resolution warnings.

#### `MH-REM-041`: Implement Local Dependency Build Integrity Verification Script
- **Epic**: Epic 7: Infrastructure, Supply Chain & Build Hardening
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Local Build Integrity
- **Technical Dependencies**: `MH-REM-040`
- **Target Files / Packages**: `scripts/verify-monorepo.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Add `scripts/verify-monorepo.ts` script checking package dependencies and export signatures across `packages/*`.
  - Add script to local pre-build checks (`pnpm verify`).

#### `MH-REM-042`: Implement Clean Local Setup & Startup Launcher (`agy start`)
- **Epic**: Epic 7: Infrastructure, Supply Chain & Build Hardening
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P3 (Low)**
- **Related Audit Findings**: Developer Experience Standard
- **Technical Dependencies**: `MH-REM-040`
- **Target Files / Packages**: `packages/cli/src/commands/start.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Verify a developer can clone repo, run `pnpm install`, `pnpm build`, and execute `agy start`.
  - `agy start` MUST launch local server on `http://127.0.0.1:3000` with clear status output.

#### `MH-REM-043`: Implement Local Environment API Key Validator
- **Epic**: Epic 7: Infrastructure, Supply Chain & Build Hardening
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: Host Setup Diagnostics
- **Technical Dependencies**: None
- **Target Files / Packages**: `packages/cli/src/env-check.ts`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - CLI MUST validate local environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) prior to starting a run.
  - If keys are missing or invalidly formatted, print friendly local setup guidance instructing developer how to configure `.env.local`.

#### `MH-REM-044`: Standardize Vitest Configuration & Package Test Scripts
- **Epic**: Epic 7: Infrastructure, Supply Chain & Build Hardening
- **Classification**: `BLOCKER_LOCAL_PRODUCT`
- **Target Readiness Level**: **Level D** (Finished Local Product)
- **Priority**: **P3 (Low)**
- **Related Audit Findings**: `MH-AUDIT-QA-004`
- **Technical Dependencies**: `MH-REM-040`
- **Target Files / Packages**: `vitest.config.ts`, `packages/*/package.json`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Update `vitest.config.ts` test inclusion globs to match modern package structures (`packages/*/src/**/*.test.ts`).
  - Add explicit `"test": "vitest run"` script to all package `package.json` files.

---

### Epic 8: QA, Observability & End-to-End Test Infrastructure

#### `MH-REM-045`: Replace String-Matching UI Tests with React Testing Library DOM Tests
- **Epic**: Epic 8: QA, Observability & End-to-End Test Infrastructure
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: `MH-AUDIT-QA-003`
- **Technical Dependencies**: `MH-REM-031`
- **Target Files / Packages**: `tests/run-loading-skeleton.test.ts`, `apps/web/src/__tests__/ui-components.test.tsx`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Replace raw `fs.readFileSync()` TSX text string matching in `tests/run-loading-skeleton.test.ts` with React Testing Library component DOM rendering assertions.
  - Tests MUST assert DOM elements, ARIA roles, and component props inside JSDOM environment.
  - Formatting changes in TSX files MUST NOT break DOM tests.

#### `MH-REM-046`: Build Playwright E2E Browser Test Suite for Local Web Application
- **Epic**: Epic 8: QA, Observability & End-to-End Test Infrastructure
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-QA-002`
- **Technical Dependencies**: `MH-REM-027`, `MH-REM-030`
- **Target Files / Packages**: `apps/web/e2e/run-lifecycle.spec.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Create Playwright E2E browser test suite covering run creation, live SSE graph visualization, human decision card responses, and completion state updates.
  - Tests MUST execute against local web server (`http://127.0.0.1:3000`) and pass cleanly in headless Chromium.

#### `MH-REM-047`: Standardize Package-Level Test Scripts & Vitest Discovery Globs
- **Epic**: Epic 8: QA, Observability & End-to-End Test Infrastructure
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: `MH-AUDIT-QA-004`
- **Technical Dependencies**: `MH-REM-044`
- **Target Files / Packages**: `package.json`, `packages/*/package.json`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Running `pnpm test` from monorepo root MUST execute unit tests across all 7 internal packages and web app.
  - Zero obsolete vitest glob warnings or missing test script errors.

#### `MH-REM-048`: Build Worktree Lifecycle & Concurrency Integration Test Suite
- **Epic**: Epic 8: QA, Observability & End-to-End Test Infrastructure
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P1 (High)**
- **Related Audit Findings**: `MH-AUDIT-GIT-001`, `MH-AUDIT-GIT-010`
- **Technical Dependencies**: `MH-REM-007`, `MH-REM-010`
- **Target Files / Packages**: `tests/integration/worktree-concurrency.test.ts`
- **Estimate / Complexity**: 5 Story Points (High)
- **Detailed Acceptance Criteria**:
  - Create integration test suite exercising `GroundingAgent` dirty workspace checks, concurrent worktree allocation, and `LiveProcessRegistry` SIGTERM cleanup.
  - Test MUST assert zero leaked worktrees, zero background process leaks, and zero dirty workspace staging.

#### `MH-REM-049`: Implement Synthetic Task Graph Wave Selector Stress Tests
- **Epic**: Epic 8: QA, Observability & End-to-End Test Infrastructure
- **Classification**: `REQUIRED_FOR_LOCAL_RELIABILITY`
- **Target Readiness Level**: **Level B** (Secure Local Use)
- **Priority**: **P2 (Medium)**
- **Related Audit Findings**: `MH-AUDIT-ORCH-002`
- **Technical Dependencies**: `MH-REM-002`
- **Target Files / Packages**: `tests/integration/graph-scheduler-stress.test.ts`
- **Estimate / Complexity**: 4 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Build synthetic graph generator producing 500-node task graphs with complex `ArtifactRequirement` and `ConflictConstraint` edges.
  - Wave selection MUST process 500-node graph in under 500ms without violating conflict constraints or missing topological dependencies.

#### `MH-REM-050`: Implement Local Diagnostic Trace Reader CLI & Web Component
- **Epic**: Epic 8: QA, Observability & End-to-End Test Infrastructure
- **Classification**: `LOCAL_HARDENING`
- **Target Readiness Level**: **Level C** (Reliable Local Beta)
- **Priority**: **P3 (Low)**
- **Related Audit Findings**: `MH-AUDIT-QA-001`
- **Technical Dependencies**: `MH-REM-019`
- **Target Files / Packages**: `packages/cli/src/commands/traces.ts`, `apps/web/src/components/trace-inspector.client.tsx`
- **Estimate / Complexity**: 3 Story Points (Medium)
- **Detailed Acceptance Criteria**:
  - Implement local trace reader command `agy run traces <runId>` and Web UI component displaying diagnostic execution traces stored in `JsonlTraceStore`.
  - Developer MUST be able to inspect sub-agent LLM prompts, tool execution logs, and timing spans directly from local workstation.
