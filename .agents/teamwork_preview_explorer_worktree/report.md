# Comprehensive Audit Report: Git Integration, Worktree Management, Candidate Commit Generation, and Tree Delivery

**Auditor**: teamwork_preview_explorer (Git & Worktrees Specialist)  
**Date**: 2026-07-21  
**Target Repository**: `Manyhands` (`packages/execution-core`, `apps/web`, `packages/contracts`, `packages/orchestrator-graph`, `packages/run-store`)  

---

## 1. Executive Summary

This audit evaluates the reliability, safety, and invariants of Git integration, worktree management, candidate commit generation, and tree delivery within the ManyHands codebase.

While the architecture mandates strong invariants—such as orchestrator-owned commits (D6), git diff as single source of truth (D5), clean worktree isolation, repository leasing (B-004/B-019), and candidate commit verification—the code audit identified **12 actionable security, safety, and correctness issues (`MH-AUDIT-GIT-001` through `MH-AUDIT-GIT-012`)**, spanning critical workspace contamination risks, resource leaks, concurrent Git lock failures, and missing identity/signing safeguards.

---

## 2. Invariant Audit Summary

| Invariant | Status | Primary Audit Finding |
|---|---|---|
| **Worktree cleanup on success/failure/crash** | 🔴 **FAILED** | V2 Execution Pipeline (`execution-pipeline.ts`) never calls `gcRun` or `clean` on completion/failure/crash, leaving all worktrees and `mh/<runId>/<taskId>` branches leaked on disk (`MH-AUDIT-GIT-001`). `WorktreeManager.clean` skips branch deletion when `worktreeRemove` fails (`MH-AUDIT-GIT-002`). |
| **Git index locking & concurrent operations** | 🔴 **FAILED** | `SimpleGitRunner` lacks index lock (`index.lock`, `HEAD.lock`) retry/backoff logic. Concurrent task execution (`maxParallel > 1`) causes `git worktree add` and `git branch -D` collision failures (`MH-AUDIT-GIT-005`). |
| **Candidate commit isolation (orchestrator-owned)** | 🟡 **PARTIAL** | Orchestrator commits do not enforce fallback Git author/committer identity (`user.name`/`user.email`) (`MH-AUDIT-GIT-007`) or disable GPG signing (`commit.gpgsign=false`) (`MH-AUDIT-GIT-008`), causing crashes or hangs in unconfigured or GPG-enabled environments. |
| **Dirty workspace protection & stash safety** | 🔴 **CRITICAL FAIL** | `GroundingAgent` modifies and commits directly in the main target repo without checking for existing dirty/uncommitted user files, staging and committing user uncommitted files into `mh-grounding` commits (`MH-AUDIT-GIT-010`). |

---

## 3. Detailed Audit Findings (`MH-AUDIT-GIT-xxx`)

### `MH-AUDIT-GIT-010` — Grounding Agent Stages and Commits User Dirty Workspace
- **Severity**: 🔴 CRITICAL
- **Location**: `packages/execution-core/src/run/grounding-agent.ts`: lines 77–101
- **Component**: Grounding Agent & Skeleton Scaffolding
- **Description**: `GroundingAgent.run` writes generated walking skeleton files directly into `params.repoRoot`, calls `this.git.addAllExcluding(params.repoRoot, DEFAULT_ARTIFACT_GLOBS)`, and commits directly to `params.repoRoot`. It does not perform a `statusPorcelain` check before running `git add -A`. If the target repository has uncommitted user files or dirty working changes, `GroundingAgent` stages and commits those uncommitted user files into Git under the commit message `"mh-grounding: walking skeleton scaffold"`.
- **Impact**: Violates workspace isolation (B-001) and corrupts user dirty workspaces by forcibly committing uncommitted work into automated scaffolding commits.
- **Remediation**: In `GroundingAgent.run`, check `git.statusPorcelain(params.repoRoot)` before modifying files. If dirty, abort grounding or isolate skeleton creation in an explicit worktree.

---

### `MH-AUDIT-GIT-001` — V2 Execution Pipeline Leaks Worktrees and Branches on Run Completion or Failure
- **Severity**: 🟠 HIGH
- **Location**: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts`: lines 111, 150–183 & `packages/execution-core/src/v2/node-executor.ts`: lines 147–222, 224–315
- **Component**: V2 Execution Pipeline & Worktree Manager
- **Description**: In `driveClaimedExecutionV2` (`execution-pipeline.ts`), `WorktreeManager` is instantiated at line 111. `V2NodeExecutor` creates worktrees for leaves, composite nodes, and candidate validation. However, neither `driveClaimedExecutionV2` nor `V2NodeExecutor` calls `worktrees.gcRun(runId)` or `worktrees.clean()` in its `finally` block or upon run completion/failure.
- **Impact**: Every V2 run leaves physical worktree folders in `<repoRoot>/.manyhands/worktrees/<runSegment>/` (or `<tmpdir>/mh-wt/`) and git branches `mh/<runId>/<taskId>` permanently on disk. Over multiple runs, disk space is exhausted and git branch listings become polluted.
- **Remediation**: Call `await worktrees.gcRun(runId)` in the `finally` block of `driveClaimedExecutionV2`.

---

### `MH-AUDIT-GIT-005` — Concurrent `git worktree add` and Ref Operations Contend on `.git/index.lock` Without Retries
- **Severity**: 🟠 HIGH
- **Location**: `packages/execution-core/src/git/runner.ts`: lines 102–136, 197–225 & `packages/execution-core/src/worktree/manager.ts`: lines 181–186
- **Component**: Git Command Runner (`SimpleGitRunner`)
- **Description**: `SimpleGitRunner.worktreeAdd`, `branchDelete`, and `commit` execute raw Git commands against `repoRoot`. When the scheduler runs parallel leaf tasks (`maxParallel > 1`), concurrent invocations of `git worktree add` or `git branch -D` race to acquire `.git/index.lock` or `.git/HEAD.lock` in the main repository. `SimpleGitRunner` does not retry on lock contention.
- **Impact**: Multi-threaded/parallel task execution crashes with `fatal: Unable to create '.git/index.lock': File exists.` or `fatal: cannot lock ref 'refs/heads/...': File exists.`.
- **Remediation**: Wrap Git operations targeting shared repository locks in exponential backoff retry loops for `index.lock` / `HEAD.lock` contention.

---

### `MH-AUDIT-GIT-007` — Missing Fallback Git Committer/Author Identity in `SimpleGitRunner`
- **Severity**: 🟠 HIGH
- **Location**: `packages/execution-core/src/git/runner.ts`: lines 220–225, 361–372
- **Component**: Git Command Runner (`SimpleGitRunner.commit`, `createIntegrationHandoff`)
- **Description**: `SimpleGitRunner.commit` (`git.commit(message)`) and `createIntegrationHandoff` (`git.raw(["commit-tree", ...])`) invoke Git commit mechanisms without supplying explicit fallback author/committer configurations (`-c user.name=ManyHands -c user.email=manyhands@local`).
- **Impact**: In automated server environments, CI/CD runners, or fresh developer setups where global `user.name` or `user.email` is not configured, orchestrator commits fail with `fatal: empty ident name (for <...>) not allowed`.
- **Remediation**: Include `-c user.name=ManyHands -c user.email=manyhands@local` or set `GIT_AUTHOR_*`/`GIT_COMMITTER_*` in `SimpleGitRunner` client parameters when git config identity is missing.

---

### `MH-AUDIT-GIT-008` — Unhandled GPG Signing Blockages in Orchestrator Commits
- **Severity**: 🟠 HIGH
- **Location**: `packages/execution-core/src/git/runner.ts`: lines 95–100, 220–225
- **Component**: Git Command Runner (`SimpleGitRunner`)
- **Description**: `SimpleGitRunner` configures `safe.directory` but does not override `commit.gpgsign`. If the host user has `commit.gpgsign = true` in their global `~/.gitconfig`, `git commit` commands executed inside worktrees attempt interactive GPG signing.
- **Impact**: Automated agent execution background processes fail or hang indefinitely waiting for interactive GPG pinentry.
- **Remediation**: Add `commit.gpgsign=false` to default config options in `SimpleGitRunner.client()`.

---

### `MH-AUDIT-GIT-002` — Branch Leakage in `WorktreeManager.clean` when `worktreeRemove` Fails
- **Severity**: 🟡 MEDIUM
- **Location**: `packages/execution-core/src/worktree/manager.ts`: lines 295–317
- **Component**: Worktree Manager (`clean`)
- **Description**: In `WorktreeManager.clean(record)`:
  ```ts
  await this.git.worktreeRemove({ repoRoot: this.repoRoot, worktreePath: record.path, force: true });
  await this.git.branchDelete({ repoRoot: this.repoRoot, branch: record.branch, force: true });
  ```
  If `worktreeRemove` throws an exception (e.g. file lock on Windows or active process inside the directory), the exception aborts execution before `branchDelete` is executed.
  - **Impact**: The branch `mh/<runId>/<taskId>` is leaked in Git, causing subsequent retries or worktree creations for the same branch name to fail.
  - **Remediation**: Wrap `worktreeRemove` and `branchDelete` in `try...finally` or separate `catch` blocks so branch deletion is attempted even if worktree removal throws.

---

### `MH-AUDIT-GIT-003` — Missing Physical Directory Cleanup in `WorktreeManager.clean`
- **Severity**: 🟡 MEDIUM
- **Location**: `packages/execution-core/src/worktree/manager.ts`: lines 295–317
- **Component**: Worktree Manager (`clean`)
- **Description**: Unlike `recreateAfterStaleLeftovers` (line 247) and `gcRun` (line 386) which run `rm(path, { recursive: true, force: true })`, `WorktreeManager.clean()` relies solely on `git worktree remove --force`. On Windows or systems with untracked/ignored files, `git worktree remove` may unlink the git reference while leaving leftover physical directories on disk.
- **Impact**: Physical directory leftovers remain on disk and cause `EEXIST` errors on subsequent worktree creation.
- **Remediation**: Add `await rm(record.path, { recursive: true, force: true }).catch(() => undefined)` after `worktreeRemove` in `clean()`.

---

### `MH-AUDIT-GIT-004` — Orphaned JSDoc Comments for `node_modules` Junctions Without Code Implementation
- **Severity**: 🟡 MEDIUM
- **Location**: `packages/execution-core/src/worktree/manager.ts`: lines 265–279
- **Component**: Worktree Manager
- **Description**: `WorktreeManager` contains JSDoc comments describing linking installed dependency directories into worktrees (junctions on Windows) and safe unlinking to avoid wiping base repo's `node_modules`. However, there is no code implementation attached to these comments.
- **Impact**: Worktrees created for tasks lack linked `node_modules`, causing validation runners (`npm test`, `tsc`, `jest`) inside worktrees to fail with exit code 127 unless dependencies are re-installed per worktree.
- **Remediation**: Either implement dependency junctioning or update comments and ensure explicit dependency installation in worktrees.

---

### `MH-AUDIT-GIT-006` — `SimpleGitRunner.isAncestor` Unhandled Error Re-throws
- **Severity**: 🟡 MEDIUM
- **Location**: `packages/execution-core/src/git/runner.ts`: lines 158–173
- **Component**: Git Command Runner (`isAncestor`)
- **Description**: `isAncestor` uses native `execFileAsync("git", ...)` and only catches exit code 1 (`if (gitExitCode(error) === 1) return false;`). Any other error code (such as Windows `EPERM`/`EACCES` file locking transients or fatal exit code 128) is re-thrown.
- **Impact**: Temporary file system lock issues or transient git errors crash integration lineage validation instead of retrying or failing gracefully.
- **Remediation**: Add retry logic or classify fatal vs non-fatal errors in `isAncestor`.

---

### `MH-AUDIT-GIT-009` — Candidate Branch Force Update Lacks Repository Lease Fencing
- **Severity**: 🟡 MEDIUM
- **Location**: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts`: lines 216–220
- **Component**: V2 Final Candidate Preparer (`finalCandidatePort`)
- **Description**: In `finalCandidatePort`:
  ```ts
  await supervisedExecFile("git", safeGitArgs(input.repoRoot, ["branch", "-f", candidateRef, integratedCommit]), { cwd: input.repoRoot, windowsHide: true });
  ```
  This command force-updates the candidate branch `manyhands/run-<runId>` directly in `input.repoRoot`. However, this call occurs asynchronously without verifying that the repository lease (`RepoLease`) is still held by the active run.
- **Impact**: If a run's lease was stolen or cancelled, a delayed candidate preparation can overwrite the candidate branch of a replacement run.
- **Remediation**: Pass the `RepoLease` into `finalCandidatePort` and invoke `assertRepoLeaseCurrent(lease)` before updating refs.

---

### `MH-AUDIT-GIT-011` — Race Condition Window in `TransactionalDeliveryPublisher` Workspace Cleanliness Check
- **Severity**: 🟡 MEDIUM
- **Location**: `packages/execution-core/src/delivery/publisher.ts`: lines 75–80
- **Component**: Delivery Publisher (`TransactionalDeliveryPublisher`)
- **Description**: `TransactionalDeliveryPublisher.publish` checks `target = await repository.inspect()` and asserts `target.clean`. There is a time-of-check to time-of-use (TOCTOU) gap between `inspect()` and `repository.publish(approval)`.
- **Impact**: If files are modified in the target workspace during this gap, publication proceeds on a dirty workspace.
- **Remediation**: Re-verify cleanliness atomically during the publishing transaction or acquire an exclusive repository lock.

---

### `MH-AUDIT-GIT-012` — Untracked Files Leaked in Worktrees After `cherryPickAbort`
- **Severity**: 🟡 MEDIUM
- **Location**: `packages/execution-core/src/integration/agent.ts`: lines 618, 915
- **Component**: Integration Agent (`integrate`)
- **Description**: When a cherry-pick fails or budget is exhausted, `IntegrationAgent` calls `this.git.cherryPickAbort(worktree.path)`. `git cherry-pick --abort` restores tracked files to `HEAD` but leaves untracked files generated during the failed cherry-pick or repair pass untouched in the worktree.
- **Impact**: Leftover untracked files pollute the worktree, corrupting subsequent cherry-pick attempts or baseline comparison checks.
- **Remediation**: Run `git clean -fd` or `restoreManagedWorktree` after `cherryPickAbort`.

---

## 4. Verification Plan

To independently verify these findings:

1. **`MH-AUDIT-GIT-010` (Grounding dirty workspace commit)**:
   - Create uncommitted file `dirty.txt` in a test repo.
   - Run `GroundingAgent.run()`.
   - Inspect `git log -1 --stat`: observe `dirty.txt` was committed in `mh-grounding`.

2. **`MH-AUDIT-GIT-001` (Worktree leakage)**:
   - Run `pnpm test` or execute a V2 run pipeline.
   - Inspect `.manyhands/worktrees/`: observe directory and branches remain after run completion.

3. **`MH-AUDIT-GIT-007` & `MH-AUDIT-GIT-008` (Identity and GPG signing)**:
   - Run orchestrator tests in an environment with `GIT_CONFIG_GLOBAL` pointing to `user.name=` empty or `commit.gpgsign=true`.
   - Observe `git commit` failure or pinentry prompt hanging.

4. **`MH-AUDIT-GIT-005` (Concurrent lock contention)**:
   - Run `WorktreeManager.create()` with 10 concurrent promises against the same `repoRoot`.
   - Observe `.git/index.lock` errors.
