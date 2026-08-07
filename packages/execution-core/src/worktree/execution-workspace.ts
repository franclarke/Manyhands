import { WorktreeRecordSchema, type WorktreeRecord } from "../types.js";
import type { CreateWorktreeParams } from "./manager.js";

/**
 * How a workspace ends.
 *
 * `discard` throws the checkout away. `candidate` first anchors the commit the
 * attempt produced under a run/attempt ref, because a commit reachable only
 * from a removed worktree is unreachable and would be collected.
 */
export type WorktreeReleaseOutcome =
  | { kind: "discard" }
  | {
      kind: "candidate";
      runId: string;
      attemptId: string;
      candidateCommit: string;
    };

export interface ExecutionWorkspaceHandle {
  worktree: WorktreeRecord;
  release(outcome?: WorktreeReleaseOutcome): Promise<void>;
}

export interface ExecutionWorkspaceProvider {
  acquire(params: CreateWorktreeParams): Promise<ExecutionWorkspaceHandle>;
}

export { WorktreeRecordSchema };
