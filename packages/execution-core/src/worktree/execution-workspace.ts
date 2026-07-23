import { nowIso } from "@manyhands/shared";

import { WorktreeRecordSchema, type WorktreeRecord } from "../types.js";
import type { CreateWorktreeParams } from "./manager.js";
import {
  WorktreePool,
  type WorktreeReleaseOutcome
} from "./worktree-pool.js";

export interface ExecutionWorkspaceHandle {
  worktree: WorktreeRecord;
  release(outcome?: WorktreeReleaseOutcome): Promise<void>;
}

export interface ExecutionWorkspaceProvider {
  acquire(params: CreateWorktreeParams): Promise<ExecutionWorkspaceHandle>;
}

export interface PooledExecutionWorkspaceProviderOptions {
  pool: WorktreePool;
  now?: () => string;
}

export class PooledExecutionWorkspaceProvider implements ExecutionWorkspaceProvider {
  private readonly pool: WorktreePool;
  private readonly now: () => string;

  constructor(options: PooledExecutionWorkspaceProviderOptions) {
    this.pool = options.pool;
    this.now = options.now ?? nowIso;
  }

  async acquire(params: CreateWorktreeParams): Promise<ExecutionWorkspaceHandle> {
    const lease = await this.pool.acquire({
      baseCommit: params.baseCommit,
      operationId: `${params.runId}:${params.taskId}`
    });
    const worktree = WorktreeRecordSchema.parse({
      taskId: params.taskId,
      runId: params.runId,
      kind: params.kind,
      path: lease.path,
      branch: `pool/${lease.slotId}`,
      baseCommit: params.baseCommit,
      status: "active",
      createdAt: this.now()
    });
    let released = false;
    return {
      worktree,
      release: async (outcome = { kind: "discard" }) => {
        if (released) return;
        await this.pool.release(lease, outcome);
        released = true;
      }
    };
  }
}
