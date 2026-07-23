# Handoff Report — Git & Worktree Integration Audit

## 1. Observation
- **Scope Examined**: `packages/execution-core` (`git/runner.ts`, `worktree/manager.ts`, `base/execution-base-builder.ts`, `delivery/candidate-preparer.ts`, `delivery/publisher.ts`, `integration/agent.ts`, `result/recorder.ts`, `v2/node-executor.ts`, `v2/exact-candidate-validator.ts`, `run/grounding-agent.ts`, `run/executor.ts`), `apps/web` (`lib/server/runs/repo-lock.ts`, `lib/server/runs/v2/execution-pipeline.ts`, `lib/server/workspaces/ensure-runnable-repo.ts`).
- **Tool Commands & Code Inspection**:
  - `packages/execution-core/src/run/grounding-agent.ts:77-101`: `GroundingAgent.run` executes `git.addAllExcluding(params.repoRoot, DEFAULT_ARTIFACT_GLOBS)` and `git.commit(...)` directly on the target repo without verifying `statusPorcelain` first.
  - `apps/web/src/lib/server/runs/v2/execution-pipeline.ts:111,150-183`: `driveClaimedExecutionV2` creates `WorktreeManager` but never calls `gcRun(runId)` in its `finally` block or on completion/failure.
  - `packages/execution-core/src/git/runner.ts:94-100,220-225`: `SimpleGitRunner` configures `safe.directory` but omits `user.name`, `user.email`, and `commit.gpgsign=false` in `commit()` and `createIntegrationHandoff()`.
  - `packages/execution-core/src/git/runner.ts:102-136`: `worktreeAdd`, `branchDelete`, and `commit` run raw git commands without retries on `.git/index.lock` or `.git/HEAD.lock` contention under parallel executions (`maxParallel > 1`).
  - `packages/execution-core/src/worktree/manager.ts:295-317`: `WorktreeManager.clean` calls `worktreeRemove` then `branchDelete`; an exception in `worktreeRemove` skips `branchDelete`, leaking `record.branch`.
  - `packages/execution-core/src/worktree/manager.ts:265-279`: Comments detailing node_modules linking/unlinking exist without matching executable code.

## 2. Logic Chain
1. **Dirty Workspace Contamination (`MH-AUDIT-GIT-010`)**: `GroundingAgent.run` receives `repoRoot` (the main user repository). It writes scaffolded skeleton files, calls `git.addAllExcluding(repoRoot, ...)` (which stages all un-ignored files), and commits. Because `statusPorcelain` is not checked prior to staging, any existing uncommitted user files in `repoRoot` are staged and committed under `mh-grounding: walking skeleton scaffold`, violating workspace cleanliness and dirty workspace protection (B-001).
2. **Worktree & Branch Leaks (`MH-AUDIT-GIT-001`, `MH-AUDIT-GIT-002`, `MH-AUDIT-GIT-003`)**: V2 execution allocates worktrees for each task node. `driveClaimedExecutionV2` completes without calling `worktrees.gcRun(runId)`. Consequently, all task worktrees under `.manyhands/worktrees/<runId>` and git branches `mh/<runId>/<taskId>` remain on disk indefinitely. In `WorktreeManager.clean()`, if `worktreeRemove` throws (e.g. due to Windows file handles), the exception prevents `branchDelete` from running, permanently leaking the task branch in Git.
3. **Identity & GPG Signing Failures (`MH-AUDIT-GIT-007`, `MH-AUDIT-GIT-008`)**: Orchestrator commits via `SimpleGitRunner.commit()` use default simple-git options. In environments lacking global `user.name`/`user.email` git config or where `commit.gpgsign=true` is enabled, commits fail with `fatal: empty ident name` or block indefinitely on interactive GPG pinentry.
4. **Git Index Lock Contention (`MH-AUDIT-GIT-005`)**: Under `maxParallel > 1`, parallel tasks call `worktreeAdd` or `branchDelete` against the shared main repository root simultaneously. Because `SimpleGitRunner` lacks lock-retry mechanisms for `.git/index.lock` or `.git/HEAD.lock`, concurrent tasks fail with unhandled Git locking errors.

## 3. Caveats
- No external HTTP or non-code network APIs were accessed (CODE_ONLY mode compliant).
- Non-git workspace fallback mechanisms outside of `packages/execution-core` and `apps/web` were not investigated.

## 4. Conclusion
The Git & Worktree audit identified 12 findings (`MH-AUDIT-GIT-001` through `MH-AUDIT-GIT-012`). The most severe issue is `MH-AUDIT-GIT-010` (CRITICAL), where `GroundingAgent` forcibly stages and commits uncommitted user files in dirty workspaces. In addition, worktree leakage (`MH-AUDIT-GIT-001`), Git index lock contention (`MH-AUDIT-GIT-005`), and missing Git author identity / GPG override (`MH-AUDIT-GIT-007`, `MH-AUDIT-GIT-008`) require remediation to achieve target stability and safety.

## 5. Verification Method
1. Full Audit Report: Inspect `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_worktree\report.md`.
2. Reproduction steps for key findings:
   - `MH-AUDIT-GIT-010`: Create an uncommitted file in a test repo and call `GroundingAgent.run()`. Verify via `git log -1 --stat` that the uncommitted file was committed.
   - `MH-AUDIT-GIT-001`: Run a V2 execution pipeline run. Verify that worktree directories under `.manyhands/worktrees/` and `mh/*` branches remain after the run finishes.
   - `MH-AUDIT-GIT-005`: Invoke 10 concurrent `worktreeAdd` calls on the same repo root and observe `.git/index.lock` contention.
