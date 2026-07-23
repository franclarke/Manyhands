# 02 — Critical System Invariants Audit

**Audit Date**: 2026-07-21  
**Target Specs**: `docs/system/01-task-graph.md` through `06-persistence-and-recovery.md`  
**Auditor**: Principal Engineering Review Board (Orchestrator Panel)  

---

## 1. System Invariants Audit Summary

| System Invariant | Target Specification | Current Implementation Status | Compliance Verdict | Primary Finding ID |
|---|---|---|---|---|
| **DAG Cycle Validation** | `docs/system/01-task-graph.md` §3 | `validateGraphRevision` checks parentage cycles (`parentId`) but ignores `ArtifactRequirement` edges. | 🔴 **FAILED** | `MH-AUDIT-ORCH-001` |
| **Conflict Constraint Enforcement**| `docs/system/13-conflict-risk.md` §4 | `selectReadyWaveV2` calculates readiness but ignores `ConflictConstraint` records in `GraphRevision`. | 🔴 **FAILED** | `MH-AUDIT-ORCH-002` |
| **Worktree Cleanup on Run Exit** | `docs/system/05-worktree-layer.md` §5 | `driveClaimedExecutionV2` omits `gcRun()` in `finally` block, leaking worktree folders on completion/crash. | 🔴 **FAILED** | `MH-AUDIT-GIT-001` |
| **Dirty Workspace Safeguards** | `AGENTS.md` Rule 2 / B-001 | `GroundingAgent` calls `git add -A` without checking `statusPorcelain`, committing uncommitted user files. | 🔴 **CRITICAL FAIL** | `MH-AUDIT-GIT-010` |
| **Lock Ownership Fencing** | `docs/system/06-persistence.md` §2 | `acquireDurableLock` release callback unconditionally deletes lock path without checking owner PID. | 🔴 **CRITICAL FAIL** | `MH-AUDIT-PERS-001` |
| **Atomic File Writes with `fsync`** | `docs/system/06-persistence.md` §4 | `atomicWrite` renames `.tmp` files without calling `fsync` and retries renames without delay. | 🔴 **FAILED** | `MH-AUDIT-PERS-002` |
| **Diagnostic Trace Persistence** | `docs/system/06-persistence.md` §6 | `InMemoryTraceStore` keeps diagnostic events strictly in memory, losing logs on process exit. | 🔴 **FAILED** | `MH-AUDIT-QA-001` |
| **Prompt Injection Envelope** | `docs/system/security-boundary.md` §3 | File snippets are concatenated directly into prompt templates without XML escaping tags. | 🔴 **FAILED** | `MH-AUDIT-AI-001` |
| **Token Budget Spending Caps** | `docs/system/security-boundary.md` §4 | `LLMDecomposer` executes prompt completions without checking max token budget limits. | 🔴 **FAILED** | `MH-AUDIT-AI-002` |
| **API Middleware Authorization** | `docs/system/security-boundary.md` §1 | All 17 Next.js API routes execute without session verification or CSRF token checks. | 🔴 **FAILED** | `MH-AUDIT-API-006` |

---

## 2. Invariant Analysis & Evidence Chains

### Invariant 1: Lock Ownership Fencing (`MH-AUDIT-PERS-001`)
- **Requirement**: A lock holder must only release a lock if it still holds valid ownership (matching PID and timestamp).
- **Code Failure**: `packages/run-store/src/jsonl-event-store.ts:180`
  ```ts
  return () => rm(lockPath, { recursive: true, force: true });
  ```
- **Consequence**: When Process A's write takes 31 seconds, Process B takes over the lock at 30 seconds. Process A finishes at 31 seconds and executes its `finally` release, deleting Process B's active lock directory. Process C then acquires the lock concurrently with Process B.

### Invariant 2: Grounding Agent Dirty Workspace Protection (`MH-AUDIT-GIT-010`)
- **Requirement**: Automated agent scaffolding must never contaminate or commit uncommitted user files in the target repository.
- **Code Failure**: `packages/execution-core/src/run/grounding-agent.ts:88-95`
  ```ts
  await this.git.addAllExcluding(params.repoRoot, DEFAULT_ARTIFACT_GLOBS);
  await this.git.commit(params.repoRoot, "mh-grounding: walking skeleton scaffold");
  ```
- **Consequence**: Any uncommitted edits in the user's workspace are forcefully committed into Git under the automated scaffolding commit.

### Invariant 3: DAG Artifact Cycle Detection (`MH-AUDIT-ORCH-001`)
- **Requirement**: `GraphRevision` must be a strict Directed Acyclic Graph (DAG) over both parentage hierarchy and `ArtifactRequirement` producer-consumer edges.
- **Code Failure**: `packages/task-graph/src/validate-v2.ts:44-88` validates only `parentId` references, ignoring cyclic artifact dependencies between nodes.
