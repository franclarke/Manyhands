import { nowIso } from "@manyhands/shared";

import { WorktreeError } from "../errors";
import { execError, execLog } from "../logging/log";
import type { GitRunner } from "../git/runner";
import { WorktreeRecordSchema, type WorktreeKind, type WorktreeRecord } from "../types";

export interface WorktreeManagerDeps {
  git: GitRunner;
  repoRoot: string;
  /** Root under which per-task worktrees are created. Default: <repoRoot>/.manyhands/worktrees */
  worktreesRoot?: string;
  /** Injectable clock for deterministic timestamps in tests. */
  now?: () => string;
}

export interface CreateWorktreeParams {
  taskId: string;
  runId: string;
  kind: WorktreeKind;
  baseCommit: string;
}

export interface UnexpectedCommitDetection {
  committed: boolean;
  sha?: string;
}

/**
 * Creates and tears down isolated git worktrees for leaf/integration tasks,
 * and detects whether an agent committed unexpectedly (D6 / ADR-0021).
 */
export class WorktreeManager {
  private readonly git: GitRunner;
  private readonly repoRoot: string;
  private readonly worktreesRoot: string;
  private readonly now: () => string;

  constructor(deps: WorktreeManagerDeps) {
    this.git = deps.git;
    this.repoRoot = deps.repoRoot;
    this.worktreesRoot = deps.worktreesRoot ?? `${deps.repoRoot}/.manyhands/worktrees`;
    this.now = deps.now ?? nowIso;
  }

  async create(params: CreateWorktreeParams): Promise<WorktreeRecord> {
    const path = `${this.worktreesRoot}/${params.runId}/${params.taskId}`;
    const branch = `mh/${params.runId}/${params.taskId}`;

    try {
      await this.git.worktreeAdd({
        repoRoot: this.repoRoot,
        worktreePath: path,
        branch,
        baseCommit: params.baseCommit
      });
    } catch (error) {
      // Surface git's real stderr (invalid ref, path exists, locked index…) — the
      // WorktreeError wrapper only carries a generic message.
      execError("worktree", "git worktree add failed", {
        task: params.taskId,
        kind: params.kind,
        path,
        branch,
        baseCommit: params.baseCommit,
        cause: error instanceof Error ? error.message : String(error)
      });
      throw new WorktreeError(
        `Failed to create worktree for task ${params.taskId}`,
        params.taskId,
        "create",
        path,
        error
      );
    }

    execLog("worktree", "worktree created", {
      task: params.taskId,
      kind: params.kind,
      branch,
      baseCommit: params.baseCommit
    });

    return WorktreeRecordSchema.parse({
      taskId: params.taskId,
      runId: params.runId,
      kind: params.kind,
      path,
      branch,
      baseCommit: params.baseCommit,
      status: "active",
      createdAt: this.now()
    });
  }

  /**
   * Record referencing a worktree created earlier in this run (same layout as
   * create() without touching git) — used by leaf repair, which re-enters the
   * task's existing worktree instead of provisioning a fresh one.
   */
  recordFor(params: CreateWorktreeParams): WorktreeRecord {
    return WorktreeRecordSchema.parse({
      taskId: params.taskId,
      runId: params.runId,
      kind: params.kind,
      path: `${this.worktreesRoot}/${params.runId}/${params.taskId}`,
      branch: `mh/${params.runId}/${params.taskId}`,
      baseCommit: params.baseCommit,
      status: "active",
      createdAt: this.now()
    });
  }

  async clean(record: WorktreeRecord): Promise<WorktreeRecord> {
    try {
      await this.git.worktreeRemove({
        repoRoot: this.repoRoot,
        worktreePath: record.path,
        force: true
      });
      await this.git.branchDelete({ repoRoot: this.repoRoot, branch: record.branch, force: true });
    } catch (error) {
      execError("worktree", "git worktree remove/branch delete failed", {
        task: record.taskId,
        path: record.path,
        branch: record.branch,
        cause: error instanceof Error ? error.message : String(error)
      });
      throw new WorktreeError(
        `Failed to clean worktree for task ${record.taskId}`,
        record.taskId,
        "clean",
        record.path,
        error
      );
    }

    return WorktreeRecordSchema.parse({
      ...record,
      status: "cleaned",
      cleanedAt: this.now()
    });
  }

  async detectUnexpectedCommit(record: WorktreeRecord): Promise<UnexpectedCommitDetection> {
    let head: string;
    try {
      head = await this.git.head(record.path);
    } catch (error) {
      throw new WorktreeError(
        `Failed to inspect HEAD for task ${record.taskId}`,
        record.taskId,
        "detect",
        record.path,
        error
      );
    }

    if (head === record.baseCommit) {
      return { committed: false };
    }
    return { committed: true, sha: head };
  }
}
