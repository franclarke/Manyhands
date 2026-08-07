import { randomUUID } from "node:crypto";

import { nowIso } from "@manyhands/shared";

import { WorktreeRecordSchema } from "../types.js";
import { runWorktreesRootFor, safeWorktreeSegment } from "./layout.js";
import type { CreateWorktreeParams } from "./manager.js";
import type {
  ExecutionWorkspaceHandle,
  ExecutionWorkspaceProvider
} from "./execution-workspace.js";
import type { WorktreeReleaseOutcome } from "./worktree-pool.js";

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
 * `add` and `remove` both mutate. The run has one owner process by
 * construction, so an in-process turnstile is the whole coordination needed
 * here; no cross-process lease, no fencing token.
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
}

export class EphemeralExecutionWorkspaceProvider implements ExecutionWorkspaceProvider {
  private readonly repoRoot: string;
  private readonly worktreesRoot: string;
  private readonly git: EphemeralWorkspaceGit;
  private readonly now: () => string;
  private readonly platform: NodeJS.Platform | undefined;
  private readonly tmpdir: (() => string) | undefined;
  /** Serializes every mutation of the repository's worktree metadata. */
  private topology: Promise<unknown> = Promise.resolve();

  constructor(options: EphemeralExecutionWorkspaceProviderOptions) {
    this.repoRoot = options.repoRoot;
    this.worktreesRoot = options.worktreesRoot;
    this.git = options.git;
    this.now = options.now ?? nowIso;
    this.platform = options.platform;
    this.tmpdir = options.tmpdir;
  }

  async acquire(params: CreateWorktreeParams): Promise<ExecutionWorkspaceHandle> {
    // The id, not the task, makes the path unique: a retry of one task is a
    // different attempt and must never inherit the previous attempt's tree.
    const workspaceId = `${safeWorktreeSegment(params.taskId)}-${randomUUID().slice(0, 8)}`;
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
        await this.serialize(() => this.git.remove({ repoRoot: this.repoRoot, worktreePath }));
      }
    };
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.topology.then(operation, operation);
    // The chain must survive a failed operation, or one error would deadlock
    // every later mutation behind a rejected promise.
    this.topology = next.catch(() => undefined);
    return next;
  }
}

/** The same ref the pool anchored to, so an existing run stays readable. */
function candidateRef(runId: string, attemptId: string): string {
  return `refs/manyhands/runs/${safeWorktreeSegment(runId)}/attempts/${safeWorktreeSegment(attemptId)}/candidate`;
}
