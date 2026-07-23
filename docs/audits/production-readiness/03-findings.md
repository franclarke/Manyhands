# 03 — Master Findings Inventory

**Audit Date**: 2026-07-21  
**Total Cataloged Findings**: 81  
**Auditor**: Principal Engineering Review Board (Orchestrator Panel)  

---

## 1. Breakdown by Category & Severity

| Domain / Category | P0 Critical | P1 High | P2 Medium | P3 Low | Total Findings |
|---|:---:|:---:|:---:|:---:|:---:|
| **Git & Worktree Layer** | 1 | 3 | 5 | 3 | **12** |
| **Persistence & Recovery** | 1 | 3 | 4 | 2 | **10** |
| **Orchestration & Scheduler** | 0 | 4 | 4 | 2 | **10** |
| **Security & Host Boundary** | 0 | 2 | 3 | 1 | **6** |
| **API & Web UI** | 0 | 4 | 10 | 2 | **16** |
| **AI Security & Cost** | 0 | 3 | 3 | 1 | **7** |
| **Infra & Supply Chain** | 0 | 1 | 7 | 2 | **10** |
| **Testing & QA** | 0 | 4 | 4 | 1 | **9** |
| **Scalability & Missing Systems** | 0 | 4 | 6 | 2 | **12** |
| **Total** | **2** | **28** | **39** | **12** | **81** |

---

## 2. P0 Critical Findings

### `MH-AUDIT-GIT-010`: Grounding Agent Stages and Commits User Dirty Workspace
- **Severity**: 🔴 P0 Critical
- **Location**: `packages/execution-core/src/run/grounding-agent.ts:77-101`
- **Evidence Tag**: `[Confirmado]`
- **Description**: `GroundingAgent.run` writes walking skeleton files directly into `params.repoRoot` and calls `git.addAllExcluding` without checking `statusPorcelain`. If the user has uncommitted files in their working copy, `GroundingAgent` stages and commits those files into Git under the commit message `"mh-grounding: walking skeleton scaffold"`.
- **Proposed Test**: `tests/git-dirty-workspace-grounding.test.ts`
- **Remediation**: Check `git.statusPorcelain(params.repoRoot)` before modifying files. Abort or isolate skeleton creation in an explicit worktree if dirty.

### `MH-AUDIT-PERS-001`: Unconditional Lock Release Deletes Active Foreign Locks
- **Severity**: 🔴 P0 Critical
- **Location**: `packages/run-store/src/jsonl-event-store.ts:173-197`
- **Evidence Tag**: `[Confirmado]`
- **Description**: In `acquireDurableLock`, the release callback is `() => rm(lockPath, { recursive: true, force: true })`. If Process A exceeds lock timeout (30s), Process B takes over the lock. When Process A finishes at 31s, its `finally` block deletes Process B's active lock directory without verifying lock ownership.
- **Proposed Test**: `tests/run-store-lock-ownership.test.ts`
- **Remediation**: Inspect `owner.json` inside `lockPath` in the release callback. Only delete `lockPath` if PID and `acquiredAt` timestamp match.

---

## 3. P1 High Findings Index

- `MH-AUDIT-SEC-001`: Unsupervised Process Spawning & Secret Leakage in Planning V2 (`apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:117`)
- `MH-AUDIT-SEC-002`: Path Traversal & Boundary Check Bypass in Scope Enforcement (`packages/execution-core/src/scope/checker.ts:46-54`)
- `MH-AUDIT-ORCH-001`: DAG Cycle Validation Omits ArtifactRequirement Dependencies (`packages/task-graph/src/validate-v2.ts:44-88`)
- `MH-AUDIT-ORCH-002`: Scheduler Ignores Compiled Graph-Level ConflictConstraints (`packages/scheduler/src/wave-selector-v2.ts:32-79`)
- `MH-AUDIT-ORCH-003`: V2ExecutionDriver Parallel Driver Promise Mutation Race (`packages/orchestrator-graph/src/v2/execution-driver.ts:112-160`)
- `MH-AUDIT-ORCH-004`: Scope Isolation Critic Over-restriction Rejects File Edits (`packages/decomposer/src/critics/scope-critic.ts:45-78`)
- `MH-AUDIT-GIT-001`: V2 Execution Pipeline Leaks Worktrees & Branches on Exit (`apps/web/src/lib/server/runs/v2/execution-pipeline.ts:111`)
- `MH-AUDIT-GIT-005`: Concurrent Git Operations Contend on `.git/index.lock` (`packages/execution-core/src/git/runner.ts:102-136`)
- `MH-AUDIT-GIT-007`: Missing Fallback Git Committer Identity in `SimpleGitRunner` (`packages/execution-core/src/git/runner.ts:220`)
- `MH-AUDIT-PERS-002`: Transient Rename Retries Lack Delay and Leak `.tmp` Files (`packages/run-store/src/jsonl-event-store.ts:254-269`)
- `MH-AUDIT-PERS-004`: Ephemeral Trace Logging via `InMemoryTraceStore` (`packages/trace-store/src/index.ts:24`)
- `MH-AUDIT-PERS-006`: `JsonlAttemptStore` Lacks `update()` Method (`packages/run-store/src/attempt-store.ts:40-75`)
- `MH-AUDIT-API-001`: Server SSE Loop Ignores Client Disconnect Signals (`apps/web/src/app/api/runs/[runId]/events/route.ts:45`)
- `MH-AUDIT-API-002`: Unbounded Client Event Buffer & $O(N^2)$ Refold Overhead (`apps/web/src/lib/client/use-live-run-model.ts:88`)
- `MH-AUDIT-API-006`: Unauthenticated API Endpoints across Web App (`apps/web/src/app/api/runs/route.ts:12`)
- `MH-AUDIT-API-008`: Local FS Pick Folder Endpoint Allows Unauthenticated Native Dialog Spawning (`apps/web/src/app/api/local-fs/pick-folder/route.ts:15`)
- `MH-AUDIT-AI-001`: Indirect Prompt Injection via Unsanitized Repository Files (`packages/decomposer/src/planner/work-breakdown.ts:112`)
- `MH-AUDIT-AI-002`: Uncapped Token Budget & Unmetered LLM Invocations (`packages/decomposer/src/llm-decomposer.ts:65`)
- `MH-AUDIT-AI-003`: Unrestricted Execution Capabilities in MCP Sidecar Wrappers (`packages/shared/src/sidecar-wrapper.ts:44`)
- `MH-AUDIT-QA-001`: Ephemeral Trace Logging Causes Diagnostic Data Evaporation (`packages/trace-store/src/index.ts:24`)
- `MH-AUDIT-QA-002`: Zero Component/DOM or E2E Browser Tests for Web Application (`apps/web/src/`)
- `MH-AUDIT-QA-003`: Fragile UI Tests Rely on Exact Code String Matching (`tests/run-loading-skeleton.test.ts:25`)
- `MH-AUDIT-QA-004`: Missing Package-Level Test Scripts & Obsolete Vitest Globs (`vitest.config.ts:12`)
- `MH-AUDIT-GAP-001`: Missing Event Store Compaction and Snapshot Truncation (`packages/run-store/src/jsonl-event-store.ts:110`)
- `MH-AUDIT-GAP-008`: $O(N^2)$ Event Store Append Re-Write Loop Under Heavy Event Loads (`packages/run-store/src/jsonl-event-store.ts:220`)
- `MH-AUDIT-GAP-009`: 3x Physical Git Worktree Disk Overhead per Node Attempt (`packages/execution-core/src/worktree/manager.ts:140`)
- `MH-AUDIT-GAP-010`: $O(N^2)$ Pairwise Conflict Risk Matrix Calculation (`packages/conflict-risk/src/analyzer.ts:88`)
- `MH-AUDIT-INFRA-001`: Workspace Specifier Inconsistencies across Package Manifests (`packages/execution-core/package.json:18`)
