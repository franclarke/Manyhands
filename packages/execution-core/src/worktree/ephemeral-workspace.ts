import { createHash, randomUUID } from "node:crypto";

import { nowIso } from "@manyhands/shared";

import { WorktreeRecordSchema } from "../types.js";
import { runWorktreesRootFor, safeWorktreeSegment } from "./layout.js";
import { withRepositoryTopology } from "./topology.js";
import type { CreateWorktreeParams } from "./manager.js";
import type {
  ExecutionWorkspaceHandle,
  ExecutionWorkspaceProvider,
  WorktreeReleaseOutcome
} from "./execution-workspace.js";


/**
 * A workspace per attempt: created fresh from the base commit, used once,
 * destroyed.
 *
 * The pool this replaces recycled a fixed set of slots, and recycling is the
 * only reason its coordination existed. A slot handed from one attempt to the
 * next must be sanitised; sanitation must be fenced against the previous owner,
 * which needs a lease; a lease needs a fencing token, staleness detection and a
 * heartbeat. Seven hundred lines of distributed-systems machinery, paid by a
 * single-process tool, to make sharing safe — when not sharing costs one
 * `git worktree add`.
 *
 * What genuinely is shared is the repository's worktree metadata, which
 * `add` and `remove` both mutate. That is serialized by `withRepositoryTopology`
 * — keyed by repository rather than held per instance, so the guarantee does
 * not depend on callers remembering to share one provider. The run has one
 * owner process by construction, so no cross-process lease is needed.
 */

export interface EphemeralWorkspaceGit {
  add(params: { repoRoot: string; worktreePath: string; baseCommit: string }): Promise<void>;
  remove(params: { repoRoot: string; worktreePath: string }): Promise<void>;
  updateRef(params: { repoRoot: string; ref: string; candidateCommit: string }): Promise<void>;
}

export interface EphemeralExecutionWorkspaceProviderOptions {
  repoRoot: string;
  /** Base directory for run workspaces, before the per-run relocation rule. */
  worktreesRoot: string;
  git: EphemeralWorkspaceGit;
  now?: () => string;
  platform?: NodeJS.Platform;
  tmpdir?: () => string;
  /** Bounded retry for transient Windows locks during `git worktree remove`. */
  removeAttempts?: number;
  waitBeforeRemoveRetry?: () => Promise<void>;
}

export class EphemeralExecutionWorkspaceProvider implements ExecutionWorkspaceProvider {
  private readonly repoRoot: string;
  private readonly worktreesRoot: string;
  private readonly git: EphemeralWorkspaceGit;
  private readonly now: () => string;
  private readonly platform: NodeJS.Platform | undefined;
  private readonly tmpdir: (() => string) | undefined;
  private readonly removeAttempts: number;
  private readonly waitBeforeRemoveRetry: () => Promise<void>;

  constructor(options: EphemeralExecutionWorkspaceProviderOptions) {
    this.repoRoot = options.repoRoot;
    this.worktreesRoot = options.worktreesRoot;
    this.git = options.git;
    this.now = options.now ?? nowIso;
    this.platform = options.platform;
    this.tmpdir = options.tmpdir;
    this.removeAttempts = Number.isInteger(options.removeAttempts) && options.removeAttempts! > 0
      ? options.removeAttempts!
      : 3;
    this.waitBeforeRemoveRetry = options.waitBeforeRemoveRetry ?? (() => new Promise((resolve) => setTimeout(resolve, 100)));
  }

  async acquire(params: CreateWorktreeParams): Promise<ExecutionWorkspaceHandle> {
    // The id, not the task, makes the path unique: a retry of one task is a
    // different attempt and must never inherit the previous attempt's tree.
    // Durable task ids can be arbitrarily descriptive. Keep that identity in
    // the record, but never copy it into a Windows filesystem path where it
    // consumes the candidate's own path budget.
    const workspaceId = createHash("sha256")
      .update(`${params.taskId}\0${randomUUID()}`)
      .digest("hex")
      .slice(0, 32);
    // The shared layout rule decides where a run's workspaces live: on Windows
    // it relocates them under the temp directory when the repository path would
    // push git past its path budget. Inventing a scheme here would reintroduce
    // a failure this layer already learned about.
    const runRoot = runWorktreesRootFor({
      worktreesRoot: this.worktreesRoot,
      runId: params.runId,
      ...(this.platform !== undefined ? { platform: this.platform } : {}),
      ...(this.tmpdir !== undefined ? { tmpdir: this.tmpdir } : {})
    });
    const worktreePath = `${runRoot}/${workspaceId}`;
    await this.serialize(() => this.git.add({
      repoRoot: this.repoRoot,
      worktreePath,
      baseCommit: params.baseCommit
    }));

    const worktree = WorktreeRecordSchema.parse({
      taskId: params.taskId,
      runId: params.runId,
      kind: params.kind,
      path: worktreePath,
      branch: `manyhands/${workspaceId}`,
      baseCommit: params.baseCommit,
      status: "active",
      createdAt: this.now()
    });

    let released = false;
    return {
      worktree,
      release: async (outcome: WorktreeReleaseOutcome = { kind: "discard" }) => {
        if (released) return;
        released = true;
        // Anchor before destroying. A commit reachable only from a removed
        // worktree is unreachable, so the order is the guarantee that a
        // verified candidate survives its workspace.
        if (outcome.kind === "candidate") {
          await this.serialize(() => this.git.updateRef({
            repoRoot: this.repoRoot,
            ref: candidateRef(outcome.runId, outcome.attemptId),
            candidateCommit: outcome.candidateCommit
          }));
        }
        await this.removeWithRetry(worktreePath);
      }
    };
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    return withRepositoryTopology(this.repoRoot, operation);
  }

  private async removeWithRetry(worktreePath: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.removeAttempts; attempt += 1) {
      try {
        await this.serialize(() => this.git.remove({ repoRoot: this.repoRoot, worktreePath }));
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.removeAttempts) await this.waitBeforeRemoveRetry();
      }
    }
    throw lastError;
  }
}

/** Candidate refs are namespaced by run, so their attempt segment need not repeat it. */
function candidateRef(runId: string, attemptId: string): string {
  return `refs/manyhands/runs/${safeWorktreeSegment(runId)}/attempts/${attemptRefSegment(runId, attemptId)}/candidate`;
}

function attemptRefSegment(runId: string, attemptId: string): string {
  const runPrefix = `${runId}:attempt:`;
  const suffix = attemptId.startsWith(runPrefix) ? attemptId.slice(runPrefix.length) : attemptId;
  const safeSuffix = safeWorktreeSegment(suffix);
  const maxLength = 32;
  if (safeSuffix.length <= maxLength) return safeSuffix;
  const hash = createHash("sha256").update(attemptId).digest("hex").slice(0, 8);
  return `${safeSuffix.slice(0, maxLength - hash.length - 1)}-${hash}`;
}
