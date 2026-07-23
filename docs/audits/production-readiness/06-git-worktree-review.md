# 06 — Git Integration & Worktrees Layer Audit

**Audit Date**: 2026-07-21  
**Target Subsystems**: `packages/execution-core/src/worktree/`, `packages/execution-core/src/git/`, `apps/web/src/lib/server/runs/`  
**Target Specs**: `docs/system/05-worktree-layer.md`, `AGENTS.md`  
**Auditor**: Teamwork Explorer (Git & Worktrees Specialist)  

---

## 1. Git & Worktree Subsystem Overview

ManyHands relies on Git worktrees (`git worktree add`) to isolate parallel node execution bases, preventing concurrent subagent file modifications from interfering with one another or corrupting the main repository working copy. 

While the system design enforces candidate commits and orchestrator-owned integration branches, the technical audit revealed **12 actionable Git bugs and safety defects**, ranging from critical host workspace contamination to worktree directory leakage and Git lock contention failures.

---

## 2. Audit Findings Summary (`MH-AUDIT-GIT-xxx`)

| Issue ID | Severity | Location | Short Description |
|---|---|---|---|
| `MH-AUDIT-GIT-010` | **P0 (Critical)** | `packages/execution-core/src/run/grounding-agent.ts:77-101` | `GroundingAgent` stages and commits uncommitted user workspace files without checking `statusPorcelain`. |
| `MH-AUDIT-GIT-001` | **P1 (High)** | `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:111` | V2 Execution Pipeline never invokes `gcRun()` on run completion/failure, leaking physical worktrees on disk. |
| `MH-AUDIT-GIT-005` | **P1 (High)** | `packages/execution-core/src/git/runner.ts:102-136` | Concurrent `git worktree add` and ref deletions race on `.git/index.lock` without exponential retry/backoff. |
| `MH-AUDIT-GIT-007` | **P1 (High)** | `packages/execution-core/src/git/runner.ts:220-225` | `SimpleGitRunner.commit` lacks fallback `user.name`/`user.email` git config parameters, crashing in unconfigured environments. |
| `MH-AUDIT-GIT-002` | **P2 (Medium)** | `packages/execution-core/src/worktree/manager.ts:295-317` | `WorktreeManager.clean` aborts before branch deletion if `worktreeRemove` throws an exception, leaking Git branches. |
| `MH-AUDIT-GIT-003` | **P2 (Medium)** | `packages/execution-core/src/worktree/manager.ts:295-317` | `WorktreeManager.clean` relies solely on `git worktree remove`, leaving physical orphaned directories on Windows. |
| `MH-AUDIT-GIT-004` | **P2 (Medium)** | `packages/execution-core/src/git/runner.ts:95-100` | Missing `-c commit.gpgsign=false` override causes automated background commits to hang on interactive GPG prompts. |
| `MH-AUDIT-GIT-006` | **P2 (Medium)** | `packages/execution-core/src/v2/exact-candidate-validator.ts:140` | Validation worktree setup fails to prune untracked leftover files before checking out candidate commit diffs. |
| `MH-AUDIT-GIT-008` | **P2 (Medium)** | `packages/execution-core/src/worktree/manager.ts:180` | Worktree path hashing collisions when run IDs contain identical prefix segments. |
| `MH-AUDIT-GIT-009` | **P3 (Low)** | `packages/execution-core/src/git/runner.ts:45` | Unparsed stderr strings on successful git command execution produce false-positive error warnings. |
| `MH-AUDIT-GIT-011` | **P3 (Low)** | `packages/execution-core/src/worktree/manager.ts:320` | `gcRun` log output prints raw absolute paths, exposing host username in logs. |
| `MH-AUDIT-GIT-012` | **P3 (Low)** | `packages/execution-core/src/git/runner.ts:310` | Hardcoded `git` binary path invocation fails when Git is located in non-standard Windows PATH locations. |

---

## 3. Deep Dive Analysis & Evidence

### `MH-AUDIT-GIT-001`: Worktree & Branch Leakage on Run Exit
- **File**: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:111,150-183`
- **Analysis**: In `driveClaimedExecutionV2`, `WorktreeManager` is instantiated on line 111. `V2NodeExecutor` allocates isolated worktrees under `<repoRoot>/.manyhands/worktrees/<runSegment>/` for every task leaf execution and candidate validation. However, `driveClaimedExecutionV2` contains no `finally` block that calls `await worktrees.gcRun(runId)` or `await worktrees.clean()`.
- **Impact**: Every run leaves physical worktree folders and `mh/<runId>/<taskId>` git branches permanently on disk. Over multiple runs, disk space is exhausted and git branch listings become polluted.

### `MH-AUDIT-GIT-005`: Index Lock Contention under Concurrent Task Execution
- **File**: `packages/execution-core/src/git/runner.ts:102-136`
- **Analysis**: `SimpleGitRunner.worktreeAdd` and `branchDelete` execute raw Git commands against the shared `repoRoot`. When the scheduler dispatches parallel leaf tasks (`maxParallel > 1`), concurrent invocations race to acquire `.git/index.lock` or `.git/HEAD.lock`. `SimpleGitRunner` does not retry on lock contention.
- **Impact**: Multi-threaded parallel task execution crashes with `fatal: Unable to create '.git/index.lock': File exists.`
