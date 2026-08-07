import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  tryAcquireFilesystemFencedLease,
  type FilesystemFencedLease
} from "./fenced-lease.js";
import { runWorktreesRootFor, safeWorktreeSegment } from "./layout.js";
import { acquireWorktreeTopologyLease, worktreeTopologyLeasePath } from "./topology-lease.js";

const DEFAULT_POOL_SIZE = 4;
const ACQUIRE_POLL_MS = 15;

export interface WorktreePoolOptions {
  repoRoot: string;
  poolRoot?: string;
  size?: number;
  gitPath?: string;
  git?: WorktreePoolGit;
  platform?: NodeJS.Platform;
  tmpdir?: () => string;
  staleLeaseMs?: number;
  heartbeatMs?: number;
  ownerIsAlive?: (pid: number) => Promise<boolean>;
  removePath?: (worktreePath: string) => Promise<void>;
}

export interface WorktreePoolGit {
  add(params: { repoRoot: string; worktreePath: string; baseCommit: string }): Promise<void>;
  resetAndClean(params: {
    worktreePath: string;
    baseCommit: string;
  }): Promise<void>;
  remove(params: { repoRoot: string; worktreePath: string }): Promise<void>;
  prune(repoRoot: string): Promise<void>;
  validate(params: { repoRoot: string; worktreePath: string }): Promise<boolean>;
  resolveCommonDir(repoRoot: string): Promise<string>;
  updateRef(params: {
    repoRoot: string;
    ref: string;
    candidateCommit: string;
  }): Promise<void>;
}

export interface WorktreeLease {
  id: string;
  slotId: string;
  path: string;
  baseCommit: string;
  operationId: string;
  token: string;
  generation: number;
  recycled: boolean;
}

export type WorktreeReleaseOutcome =
  | { kind: "discard" }
  | {
      kind: "candidate";
      runId: string;
      attemptId: string;
      candidateCommit: string;
    };

interface PoolSlot {
  id: string;
  path: string;
  useCount: number;
  adopted: boolean;
}

interface ActiveLease {
  publicLease: WorktreeLease;
  fencedLease: FilesystemFencedLease;
  slot: PoolSlot;
}

export class WorktreePool {
  private readonly repoRoot: string;
  private readonly poolRoot: string;
  private readonly size: number;
  private readonly git: WorktreePoolGit;
  private readonly staleLeaseMs: number | undefined;
  private readonly heartbeatMs: number | undefined;
  private readonly ownerIsAlive: ((pid: number) => Promise<boolean>) | undefined;
  private readonly removePath: (worktreePath: string) => Promise<void>;
  private readonly tmpdir: (() => string) | undefined;
  private readonly slots: PoolSlot[] = [];
  private readonly activeLeases = new Map<string, ActiveLease>();
  private readonly ownerId = `pool-${process.pid}-${randomUUID()}`;
  private initialization: Promise<void> | undefined;
  private controlRoot: string | undefined;
  private topologyLeasePath: string | undefined;
  private disposed = false;

  constructor(options: WorktreePoolOptions) {
    const size = options.size ?? DEFAULT_POOL_SIZE;
    if (!Number.isInteger(size) || size < 1) {
      throw new Error("Worktree pool size must be a positive integer.");
    }
    this.repoRoot = path.resolve(options.repoRoot);
    const poolKey = createHash("sha256")
      .update(this.repoRoot.toLowerCase())
      .digest("hex")
      .slice(0, 12);
    this.poolRoot = options.poolRoot !== undefined
      ? path.resolve(options.poolRoot)
      : path.resolve(runWorktreesRootFor({
          worktreesRoot: path.join(this.repoRoot, ".manyhands", "worktree-pool"),
          runId: poolKey,
          ...(options.platform !== undefined ? { platform: options.platform } : {}),
          ...(options.tmpdir !== undefined ? { tmpdir: options.tmpdir } : {})
        }));
    if (this.poolRoot === this.repoRoot || isAncestorPath(this.poolRoot, this.repoRoot)) {
      throw new Error("Worktree pool root must not be the repository root or one of its ancestors.");
    }
    this.size = size;
    this.git = options.git ?? new NativeWorktreePoolGit(options.gitPath);
    this.staleLeaseMs = options.staleLeaseMs;
    this.heartbeatMs = options.heartbeatMs;
    this.ownerIsAlive = options.ownerIsAlive;
    this.removePath = options.removePath ?? removeWorktreePath;
    this.tmpdir = options.tmpdir;
  }

  async initialize(baseCommitOrInput: string | { baseCommit: string }): Promise<void> {
    this.assertUsable();
    const baseCommit = typeof baseCommitOrInput === "string"
      ? baseCommitOrInput
      : baseCommitOrInput.baseCommit;
    assertCommit(baseCommit);
    if (this.slots.length > 0) return;
    if (this.initialization !== undefined) return this.initialization;
    this.initialization = this.initializeUnderTopologyLease(baseCommit);
    try {
      await this.initialization;
    } finally {
      this.initialization = undefined;
    }
  }

  async acquire(input: {
    baseCommit: string;
    operationId?: string;
    signal?: AbortSignal;
  }): Promise<WorktreeLease> {
    this.assertUsable();
    assertCommit(input.baseCommit);
    await this.initialize(input.baseCommit);
    const operationId = input.operationId ?? `operation-${randomUUID()}`;

    for (;;) {
      this.assertUsable();
      throwIfAborted(input.signal);
      for (const slot of this.slots) {
        const fencedLease = await tryAcquireFilesystemFencedLease(
          this.slotLeasePath(slot),
          operationId,
          this.leaseOptions()
        );
        if (fencedLease === undefined) continue;
        try {
          await fencedLease.assertCurrent();
          await this.git.resetAndClean({
            worktreePath: slot.path,
            baseCommit: input.baseCommit
          });
          await fencedLease.assertCurrent();
          const publicLease: WorktreeLease = {
            id: randomUUID(),
            slotId: slot.id,
            path: slot.path,
            baseCommit: input.baseCommit,
            operationId,
            token: fencedLease.token,
            generation: fencedLease.generation,
            recycled: slot.adopted || slot.useCount > 0
          };
          slot.useCount += 1;
          this.activeLeases.set(publicLease.id, { publicLease, fencedLease, slot });
          return publicLease;
        } catch (error) {
          await this.recreateOwnedSlot(slot, fencedLease, input.baseCommit).catch(() => undefined);
          await fencedLease.release();
          throw error;
        }
      }
      await waitForPoll(input.signal);
    }
  }

  async release(
    lease: WorktreeLease,
    outcome: WorktreeReleaseOutcome = { kind: "discard" }
  ): Promise<void> {
    this.assertUsable();
    const active = this.activeLeases.get(lease.id);
    if (
      active === undefined ||
      active.publicLease.path !== lease.path ||
      active.publicLease.baseCommit !== lease.baseCommit ||
      active.publicLease.token !== lease.token ||
      active.publicLease.generation !== lease.generation
    ) {
      throw new Error(`Worktree lease ${lease.id} is not active in this pool.`);
    }

    try {
      await active.fencedLease.assertCurrent();
    } catch (error) {
      try {
        await active.fencedLease.release();
      } finally {
        this.activeLeases.delete(lease.id);
      }
      throw error;
    }
    let anchorError: unknown;
    if (outcome.kind === "candidate") {
      try {
        assertCommit(outcome.candidateCommit);
        const topologyLease = await this.acquireTopologyLease();
        try {
          await active.fencedLease.assertCurrent();
          await this.git.updateRef({
            repoRoot: this.repoRoot,
            ref: candidateRef(outcome.runId, outcome.attemptId),
            candidateCommit: outcome.candidateCommit
          });
          await active.fencedLease.assertCurrent();
        } finally {
          await topologyLease.release();
        }
      } catch (error) {
        anchorError = error;
      }
    }
    try {
      await this.git.resetAndClean({
        worktreePath: active.slot.path,
        baseCommit: lease.baseCommit
      });
      await active.fencedLease.assertCurrent();
    } catch (error) {
      try {
        await active.fencedLease.assertCurrent();
      } catch {
        try {
          await active.fencedLease.release();
        } finally {
          this.activeLeases.delete(lease.id);
        }
        throw error;
      }
      try {
        await this.recreateOwnedSlot(active.slot, active.fencedLease, lease.baseCommit);
      } catch {
        // Keep the fenced lease active. A later release retry can recover the
        // slot; it must never become available while sanitation is uncertain.
        throw error;
      }
    }

    await active.fencedLease.release();
    this.activeLeases.delete(lease.id);
    if (anchorError !== undefined) {
      throw new Error(
        `Could not anchor candidate for worktree lease ${lease.id}.`,
        { cause: anchorError }
      );
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    if (this.activeLeases.size > 0) {
      throw new Error("Cannot dispose a worktree pool while leases are active.");
    }
    if (this.initialization !== undefined) await this.initialization;
    if (this.slots.length === 0) {
      this.disposed = true;
      return;
    }

    const topologyLease = await this.acquireTopologyLease();
    const slotLeases: FilesystemFencedLease[] = [];
    try {
      for (const slot of this.slots) {
        const slotLease = await tryAcquireFilesystemFencedLease(
          this.slotLeasePath(slot),
          `${this.ownerId}:dispose`,
          this.leaseOptions()
        );
        if (slotLease === undefined) {
          throw new Error(`Cannot dispose worktree pool while slot ${slot.id} is leased.`);
        }
        slotLeases.push(slotLease);
      }
      const failures: unknown[] = [];
      for (const slot of this.slots) {
        try {
          await this.git.remove({ repoRoot: this.repoRoot, worktreePath: slot.path });
        } catch (error) {
          failures.push(error);
        }
      }
      await this.git.prune(this.repoRoot).catch((error) => failures.push(error));
      if (failures.length > 0) {
        throw new AggregateError(failures, "Failed to dispose every worktree pool slot.");
      }
      this.slots.splice(0);
      this.disposed = true;
    } finally {
      await Promise.allSettled(slotLeases.map((lease) => lease.release()));
      await topologyLease.release();
    }
  }

  get capacity(): number {
    return this.size;
  }

  private async initializeUnderTopologyLease(baseCommit: string): Promise<void> {
    await mkdir(this.poolRoot, { recursive: true });
    await this.resolveControlRoot();
    const topologyLease = await this.acquireTopologyLease();
    try {
      const created: PoolSlot[] = [];
      for (let index = 0; index < this.size; index += 1) {
        const id = `slot-${String(index).padStart(3, "0")}`;
        const worktreePath = path.join(this.poolRoot, id);
        const valid = await this.git.validate({
          repoRoot: this.repoRoot,
          worktreePath
        });
        if (!valid) {
          await this.removeInvalidSlot(id, worktreePath);
          try {
            await this.git.add({
              repoRoot: this.repoRoot,
              worktreePath,
              baseCommit
            });
          } catch (error) {
            await Promise.allSettled(
              created
                .filter((slot) => !slot.adopted)
                .map((slot) => this.git.remove({
                  repoRoot: this.repoRoot,
                  worktreePath: slot.path
                }))
            );
            throw worktreePoolUnavailable(`could not create slot ${id}`, error);
          }
        }
        const slot = { id, path: worktreePath, useCount: valid ? 1 : 0, adopted: valid };
        this.slots.push(slot);
        created.push(slot);
      }
    } finally {
      await topologyLease.release();
    }
  }

  private async recreateOwnedSlot(
    slot: PoolSlot,
    slotLease: FilesystemFencedLease,
    baseCommit: string
  ): Promise<void> {
    await slotLease.assertCurrent();
    const topologyLease = await this.acquireTopologyLease();
    try {
      await slotLease.assertCurrent();
      await this.removeInvalidSlot(slot.id, slot.path);
      try {
        await this.git.add({ repoRoot: this.repoRoot, worktreePath: slot.path, baseCommit });
      } catch (error) {
        throw worktreePoolUnavailable(`could not recreate slot ${slot.id}`, error);
      }
      await slotLease.assertCurrent();
      slot.adopted = true;
    } finally {
      await topologyLease.release();
    }
  }

  private async resolveControlRoot(): Promise<string> {
    if (this.controlRoot !== undefined) return this.controlRoot;
    const commonDir = await this.git.resolveCommonDir(this.repoRoot);
    const poolIdentity = createHash("sha256")
      .update(this.poolRoot.toLowerCase())
      .digest("hex")
      .slice(0, 16);
    this.controlRoot = path.join(
      commonDir,
      "manyhands",
      "worktree-pools",
      poolIdentity
    );
    this.topologyLeasePath = worktreeTopologyLeasePath(this.repoRoot, this.tmpdir);
    await mkdir(this.controlRoot, { recursive: true });
    return this.controlRoot;
  }

  private async removeInvalidSlot(id: string, worktreePath: string): Promise<void> {
    await this.git.remove({ repoRoot: this.repoRoot, worktreePath }).catch(() => undefined);
    try {
      await this.removePath(worktreePath);
    } catch (error) {
      // Windows can briefly report EBUSY for an already-empty orphan after a
      // worktree process exits. An empty directory is safe for `git worktree
      // add` to reuse; a non-empty directory remains a hard infrastructure
      // failure because reusing it could hide stale files.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" || !(await isEmptyDirectory(worktreePath))) {
        throw worktreePoolUnavailable(`could not remove invalid slot ${id}: ${describeRemovalFailure(error)}`, error);
      }
    }
    if (await pathExists(worktreePath) && !(await isEmptyDirectory(worktreePath))) {
      throw worktreePoolUnavailable(`could not remove invalid slot ${id}: the path still exists at ${worktreePath}`);
    }
    await this.git.prune(this.repoRoot).catch(() => undefined);
  }

  private async acquireTopologyLease(): Promise<FilesystemFencedLease> {
    await this.resolveControlRoot();
    if (this.topologyLeasePath === undefined) {
      throw new Error("Worktree topology lease path is not initialized.");
    }
    for (;;) {
      this.assertUsable();
      const lease = await acquireWorktreeTopologyLease(
        this.repoRoot,
        `${this.ownerId}:topology`,
        {
          ...this.leaseOptions(),
          ...(this.tmpdir === undefined ? {} : { tmpdir: this.tmpdir })
        }
      );
      if (lease !== undefined) return lease;
      await waitForPoll();
    }
  }

  private slotLeasePath(slot: PoolSlot): string {
    if (this.controlRoot === undefined) {
      throw new Error("Worktree pool control root is not initialized.");
    }
    return path.join(this.controlRoot, "slots", slot.id, "lease");
  }

  private leaseOptions(): {
    staleMs?: number;
    heartbeatMs?: number;
    ownerIsAlive?: (pid: number) => Promise<boolean>;
  } {
    return {
      ...(this.staleLeaseMs !== undefined ? { staleMs: this.staleLeaseMs } : {}),
      ...(this.heartbeatMs !== undefined ? { heartbeatMs: this.heartbeatMs } : {}),
      ...(this.ownerIsAlive !== undefined ? { ownerIsAlive: this.ownerIsAlive } : {})
    };
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Worktree pool is disposed.");
  }
}

export { WorktreePool as WorktreeRecyclingPool };

export class NativeWorktreePoolGit implements WorktreePoolGit {
  private readonly gitPath: string;

  constructor(gitPath = "git") {
    this.gitPath = gitPath;
  }

  async add(params: {
    repoRoot: string;
    worktreePath: string;
    baseCommit: string;
  }): Promise<void> {
    await mkdir(path.dirname(params.worktreePath), { recursive: true });
    await runGit(this.gitPath, params.repoRoot, [
      "worktree",
      "add",
      "--detach",
      params.worktreePath,
      params.baseCommit
    ]);
  }

  async resetAndClean(params: {
    worktreePath: string;
    baseCommit: string;
  }): Promise<void> {
    await runGit(this.gitPath, params.worktreePath, ["reset", "--hard", params.baseCommit]);
    await runGit(this.gitPath, params.worktreePath, ["clean", "-fd"]);
    await runGit(this.gitPath, params.worktreePath, ["clean", "-fdx"]);
    const head = await runGitOutput(this.gitPath, params.worktreePath, ["rev-parse", "HEAD"]);
    if (head !== params.baseCommit) {
      throw new Error(`Recycled worktree resolved ${head}, expected ${params.baseCommit}.`);
    }
    const status = await runGitOutput(this.gitPath, params.worktreePath, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    ]);
    if (status !== "") {
      throw new Error(`Recycled worktree is not clean: ${status}`);
    }
  }

  async remove(params: { repoRoot: string; worktreePath: string }): Promise<void> {
    if (!(await pathExists(params.worktreePath))) return;
    await runGit(this.gitPath, params.repoRoot, [
      "worktree",
      "remove",
      "--force",
      params.worktreePath
    ]);
  }

  async prune(repoRoot: string): Promise<void> {
    await runGit(this.gitPath, repoRoot, ["worktree", "prune"]);
  }

  async validate(params: {
    repoRoot: string;
    worktreePath: string;
  }): Promise<boolean> {
    if (!(await pathExists(params.worktreePath))) return false;
    try {
      const inside = await runGitOutput(
        this.gitPath,
        params.worktreePath,
        ["rev-parse", "--is-inside-work-tree"]
      );
      if (inside !== "true") return false;
      const [repositoryCommonDir, worktreeCommonDir, porcelain] = await Promise.all([
        this.resolveCommonDir(params.repoRoot),
        this.resolveCommonDir(params.worktreePath),
        runGitOutput(this.gitPath, params.repoRoot, ["worktree", "list", "--porcelain", "-z"])
      ]);
      if (!sameFilesystemPath(repositoryCommonDir, worktreeCommonDir)) return false;
      const registeredPaths = porcelain
        .split("\0")
        .filter((record) => record.startsWith("worktree "))
        .map((record) => record.slice("worktree ".length));
      return registeredPaths.some((candidate) =>
        sameFilesystemPath(candidate, params.worktreePath)
      );
    } catch {
      return false;
    }
  }

  async resolveCommonDir(repoRoot: string): Promise<string> {
    const raw = await runGitOutput(this.gitPath, repoRoot, [
      "rev-parse",
      "--git-common-dir"
    ]);
    return path.resolve(repoRoot, raw);
  }

  async updateRef(params: {
    repoRoot: string;
    ref: string;
    candidateCommit: string;
  }): Promise<void> {
    const zeroCommit = "0".repeat(params.candidateCommit.length);
    try {
      await runGit(this.gitPath, params.repoRoot, [
        "update-ref",
        params.ref,
        params.candidateCommit,
        zeroCommit
      ]);
    } catch (error) {
      const existing = await runGitOutput(
        this.gitPath,
        params.repoRoot,
        ["rev-parse", "--verify", params.ref]
      ).catch(() => undefined);
      if (existing === params.candidateCommit) return;
      throw error;
    }
  }
}

function runGit(gitPath: string, cwd: string, args: readonly string[]): Promise<void> {
  return runGitOutput(gitPath, cwd, args).then(() => undefined);
}

function runGitOutput(
  gitPath: string,
  cwd: string,
  args: readonly string[]
): Promise<string> {
  const safeDirectory = path.resolve(cwd).replaceAll("\\", "/");
  return new Promise((resolve, reject) => {
    execFile(
      gitPath,
      ["-c", `safe.directory=${safeDirectory}`, ...args],
      { cwd, encoding: "utf8", windowsHide: true },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(
            `git ${args.join(" ")} failed in ${cwd}: ${stderr.trim() || error.message}`,
            { cause: error }
          ));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function candidateRef(runId: string, attemptId: string): string {
  return `refs/manyhands/runs/${safeWorktreeSegment(runId)}/attempts/${safeWorktreeSegment(attemptId)}/candidate`;
}

async function removeWorktreePath(worktreePath: string): Promise<void> {
  await rm(worktreePath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100
  });
}

function worktreePoolUnavailable(action: string, cause?: unknown): Error {
  return new Error(`worktree_pool_unavailable: ${action}`, cause === undefined ? undefined : { cause });
}

/**
 * El `cause` de un error no viaja al journal: sólo el mensaje. Un slot que no se
 * puede borrar dejó dos intentos de hoja sin explicación por eso mismo, así que
 * el código de sistema y la ruta exacta viajan en el texto.
 */
function describeRemovalFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  const failedPath = (error as NodeJS.ErrnoException).path;
  return [
    code === undefined ? undefined : `code=${code}`,
    failedPath === undefined ? undefined : `path=${failedPath}`,
    error.message
  ].filter((part) => part !== undefined).join(" ");
}

function assertCommit(commit: string): void {
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) {
    throw new Error(`Worktree pool base commit is invalid: ${commit}.`);
  }
}

function isAncestorPath(candidateAncestor: string, target: string): boolean {
  const relative = path.relative(candidateAncestor, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sameFilesystemPath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function isEmptyDirectory(candidate: string): Promise<boolean> {
  try {
    return (await readdir(candidate)).length === 0;
  } catch {
    return false;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Worktree pool acquisition aborted.");
  }
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ACQUIRE_POLL_MS);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Worktree pool acquisition aborted.")
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
