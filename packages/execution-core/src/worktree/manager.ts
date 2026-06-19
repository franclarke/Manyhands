import { createHash } from "node:crypto";
import { lstat, readdir, rm, stat, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";

import { nowIso } from "@manyhands/shared";

import { WorktreeError } from "../errors";
import { execError, execLog, execWarn } from "../logging/log";
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

/**
 * Dependency directories linked from the base repo into each worktree. git
 * worktrees never carry untracked/gitignored trees, so without this a worktree
 * has no node_modules and `npm test` → `jest` dies with exit 127 ("command not
 * found"). A junction (win32) / dir symlink points the worktree at the deps the
 * human already installed, so validation runs against the same toolchain.
 */
const DEPENDENCY_LINK_DIRS: readonly string[] = ["node_modules"];
const MAX_WORKTREE_SEGMENT_LENGTH = 64;
const WINDOWS_RESERVED_SEGMENTS = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

export function safeWorktreeSegment(id: string): string {
  const trimmed = id.trim();
  const normalized = trimmed
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const needsRewrite =
    normalized.length === 0 ||
    normalized !== trimmed ||
    normalized.length > MAX_WORKTREE_SEGMENT_LENGTH ||
    WINDOWS_RESERVED_SEGMENTS.has(normalized.toUpperCase());

  if (!needsRewrite) {
    return normalized;
  }

  const hash = createHash("sha256").update(id).digest("hex").slice(0, 8);
  const prefix =
    normalized.length === 0 || WINDOWS_RESERVED_SEGMENTS.has(normalized.toUpperCase())
      ? "id"
      : normalized.slice(0, MAX_WORKTREE_SEGMENT_LENGTH - hash.length - 1);
  return `${prefix}-${hash}`;
}

export function worktreePathFor(params: { worktreesRoot: string; runId: string; taskId: string }): string {
  const root = params.worktreesRoot.replace(/[\\/]+$/, "");
  return `${root}/${safeWorktreeSegment(params.runId)}/${safeWorktreeSegment(params.taskId)}`;
}

export function worktreeBranchFor(params: { runId: string; taskId: string }): string {
  return `mh/${safeWorktreeSegment(params.runId)}/${safeWorktreeSegment(params.taskId)}`;
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
    const path = worktreePathFor({ worktreesRoot: this.worktreesRoot, runId: params.runId, taskId: params.taskId });
    const branch = worktreeBranchFor({ runId: params.runId, taskId: params.taskId });

    try {
      await this.git.worktreeAdd({
        repoRoot: this.repoRoot,
        worktreePath: path,
        branch,
        baseCommit: params.baseCommit
      });
    } catch (error) {
      // A previous attempt may have left this worktree/branch behind (e.g. a
      // failed integration the human chose to retry at the conflict gate).
      // Tear the leftovers down and try exactly once more; any other cause
      // fails the same way twice and surfaces below.
      const recreated = await this.recreateAfterStaleLeftovers(path, branch, params);
      if (!recreated) {
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
      execLog("worktree", "worktree recreated after stale leftovers", {
        task: params.taskId,
        kind: params.kind,
        branch
      });
    }

    await this.linkDependencies(path, params);

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

  /** Best-effort cleanup of a stale worktree dir + branch, then one fresh create. */
  private async recreateAfterStaleLeftovers(
    path: string,
    branch: string,
    params: CreateWorktreeParams
  ): Promise<boolean> {
    await this.unlinkDependencies(path);
    await this.git
      .worktreeRemove({ repoRoot: this.repoRoot, worktreePath: path, force: true })
      .catch(() => undefined);
    await this.git.worktreePrune(this.repoRoot).catch(() => undefined);
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    await this.git
      .branchDelete({ repoRoot: this.repoRoot, branch, force: true })
      .catch(() => undefined);
    try {
      await this.git.worktreeAdd({
        repoRoot: this.repoRoot,
        worktreePath: path,
        branch,
        baseCommit: params.baseCommit
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Link the base repo's installed dependency dirs into the worktree so
   * validation commands resolve their binaries. Best-effort: a missing base
   * node_modules (deps not installed) or an unsupported FS just means the agent
   * must install deps itself — never fail worktree creation over a link.
   */
  private async linkDependencies(worktreePath: string, params: CreateWorktreeParams): Promise<void> {
    for (const dir of DEPENDENCY_LINK_DIRS) {
      const source = join(this.repoRoot, dir);
      const target = join(worktreePath, dir);
      try {
        const sourceStat = await stat(source).catch(() => undefined);
        if (sourceStat === undefined || !sourceStat.isDirectory()) continue;
        if (await pathExists(target)) continue;
        // "junction" on win32 needs no elevated privileges, unlike a dir symlink.
        await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
        execLog("worktree", "linked dependency dir", {
          task: params.taskId,
          kind: params.kind,
          dir
        });
      } catch (error) {
        execWarn("worktree", "dependency dir link failed", {
          task: params.taskId,
          dir,
          cause: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Remove dependency links before deleting a worktree dir. Critical on Windows:
   * a junction left in place can make a recursive delete follow the link and
   * wipe the base repo's node_modules. Unlinking the link (never its target) is
   * safe and idempotent.
   */
  private async unlinkDependencies(worktreePath: string): Promise<void> {
    for (const dir of DEPENDENCY_LINK_DIRS) {
      const target = join(worktreePath, dir);
      try {
        const linkStat = await lstat(target).catch(() => undefined);
        if (linkStat === undefined || !linkStat.isSymbolicLink()) continue;
        await unlink(target);
      } catch (error) {
        execWarn("worktree", "dependency dir unlink failed", {
          path: target,
          cause: error instanceof Error ? error.message : String(error)
        });
      }
    }
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
      path: worktreePathFor({ worktreesRoot: this.worktreesRoot, runId: params.runId, taskId: params.taskId }),
      branch: worktreeBranchFor({ runId: params.runId, taskId: params.taskId }),
      baseCommit: params.baseCommit,
      status: "active",
      createdAt: this.now()
    });
  }

  async clean(record: WorktreeRecord): Promise<WorktreeRecord> {
    try {
      await this.unlinkDependencies(record.path);
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

  /**
   * Garbage-collect every worktree of a run by directory convention
   * (`<worktreesRoot>/<runId>/*` ↔ branch `mh/<runId>/<taskId>`), used on
   * cancel/cleanup where no in-memory records survive. Best-effort per entry —
   * one stuck worktree must not block the rest — and finishes with
   * `git worktree prune` plus removal of the (now empty) run directory.
   *
   * Branches in `options.preserveBranchesFor` are kept: they anchor recorded
   * evidence commits (a deleted branch leaves the commit dangling and a later
   * `git gc` would destroy the only copy of that leaf's work).
   */
  async gcRun(
    runId: string,
    options: { preserveBranchesFor?: ReadonlySet<string> } = {}
  ): Promise<{ removed: string[]; failed: string[] }> {
    const runSegment = safeWorktreeSegment(runId);
    const runRoot = join(this.worktreesRoot, runSegment);
    const preservedSegments = new Set(
      Array.from(options.preserveBranchesFor ?? []).map((taskId) => safeWorktreeSegment(taskId))
    );
    let entries: string[];
    try {
      entries = await readdir(runRoot);
    } catch {
      return { removed: [], failed: [] }; // no worktrees for this run
    }

    const removed: string[] = [];
    const failed: string[] = [];
    for (const taskSegment of entries) {
      const path = join(runRoot, taskSegment);
      const branch = `mh/${runSegment}/${taskSegment}`;
      try {
        await this.unlinkDependencies(path);
        await this.git.worktreeRemove({ repoRoot: this.repoRoot, worktreePath: path, force: true });
        removed.push(taskSegment);
      } catch (error) {
        execWarn("worktree", "gc: worktree remove failed", {
          task: taskSegment,
          path,
          cause: error instanceof Error ? error.message : String(error)
        });
        failed.push(taskSegment);
      }
      if (preservedSegments.has(taskSegment)) {
        continue; // The branch anchors a recorded evidence commit.
      }
      try {
        await this.git.branchDelete({ repoRoot: this.repoRoot, branch, force: true });
      } catch {
        // Branch may not exist (worktree died before the first commit) — fine.
      }
    }

    try {
      await this.git.worktreePrune(this.repoRoot);
    } catch (error) {
      execWarn("worktree", "gc: worktree prune failed", {
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    await rm(runRoot, { recursive: true, force: true }).catch(() => undefined);

    execLog("worktree", "gc completed", { runId, removed: removed.length, failed: failed.length });
    return { removed, failed };
  }

  /**
   * Current git HEAD of the worktree. Leaf repair reads this before re-running
   * the agent so the recorder can baseline its unexpected-commit detection
   * against the orchestrator's prior commit instead of the original baseCommit.
   */
  async headOf(record: WorktreeRecord): Promise<string> {
    return this.git.head(record.path);
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

/** True when the path exists (file, dir, or link), without throwing on ENOENT. */
async function pathExists(target: string): Promise<boolean> {
  return lstat(target).then(
    () => true,
    () => false
  );
}
