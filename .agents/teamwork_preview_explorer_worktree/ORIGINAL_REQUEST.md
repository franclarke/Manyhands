## 2026-07-21T23:50:31Z
<USER_REQUEST>
You are teamwork_preview_explorer (Git & Worktrees Specialist).
Your working directory is: c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_worktree

Task:
Audit Git integration, worktree management, candidate commit generation, and tree delivery across the codebase.
1. Inspect Git command wrappers, worktree allocation/deallocation, branch isolation, candidate commit generation, and conflict resolution in `packages/execution-core` and related packages.
2. Check for invariants:
   - Worktree cleanup on success/failure/crash
   - Git index locking and concurrent operation handling
   - Candidate commit isolation (orchestrator-owned commits)
   - Dirty workspace protection & stash safety
3. Identify edge cases, leaked worktrees, untracked file issues, broken git operations with exact line numbers and severity (`MH-AUDIT-GIT-xxx`).

Write your complete report to `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_worktree\report.md`.
Send a completion message when done via send_message.
</USER_REQUEST>
