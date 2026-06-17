/**
 * Per-target-repo run lock (U7).
 *
 * Two pipelines driving the same repository concurrently race on the git
 * index, worktree bookkeeping and the final apply — silent corruption. The
 * lock file `<repoRoot>/.manyhands/run.lock` makes ownership explicit:
 *
 *  - Acquisition is ATOMIC (`wx` open flag): of N concurrent acquirers exactly
 *    one wins; the rest learn who owns the repo.
 *  - The lock's lifetime is "while a runner is actively driving" — pipelines
 *    acquire on start/resume and release in their finally. A run suspended on
 *    a gate holds no lock (its worktrees/branches are runId-namespaced).
 *  - Stale locks are stolen: a crashed process (dead PID) or an owner run
 *    whose heartbeat went silent cannot hold the repo hostage.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isProcessAlive } from "@manyhands/execution-core";
import { DEFAULT_STALE_MS } from "./interrupted";
import { isRunnerActive } from "./runner-state";
import { getRunRepository } from "./store";

export interface RepoLockOwner {
  runId: string;
  pid: number;
  acquiredAt: string;
}

export type RepoLockResult =
  | { acquired: true; stolen: boolean }
  | { acquired: false; owner: RepoLockOwner };

/** Injectable for tests. */
export interface RepoLockDeps {
  ownerIsLive?: (owner: RepoLockOwner) => Promise<boolean>;
  now?: () => string;
}

function lockPath(repoRoot: string): string {
  return join(repoRoot, ".manyhands", "run.lock");
}

/**
 * Is the recorded owner still actively driving? Same-process owners are
 * checked against the in-process runner registry; foreign processes by PID
 * liveness first, then by the owner run's persisted heartbeat.
 */
async function defaultOwnerIsLive(owner: RepoLockOwner): Promise<boolean> {
  if (owner.pid === process.pid) {
    return isRunnerActive(owner.runId);
  }
  if (!isProcessAlive(owner.pid)) {
    return false;
  }
  const run = await getRunRepository()
    .get(owner.runId)
    .catch(() => null);
  if (run === null) return false;
  const live = run.status === "generating" || run.status === "running" || run.status === "paused";
  if (!live) return false;
  const lastBeat = new Date(run.heartbeatAt ?? run.updatedAt).getTime();
  return Number.isFinite(lastBeat) && Date.now() - lastBeat < DEFAULT_STALE_MS;
}

export async function acquireRepoLock(
  repoRoot: string,
  runId: string,
  deps: RepoLockDeps = {}
): Promise<RepoLockResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const ownerIsLive = deps.ownerIsLive ?? defaultOwnerIsLive;
  await mkdir(join(repoRoot, ".manyhands"), { recursive: true });
  const payload = JSON.stringify({ runId, pid: process.pid, acquiredAt: now() } satisfies RepoLockOwner);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath(repoRoot), payload, { encoding: "utf8", flag: "wx" });
      return { acquired: true, stolen: attempt > 0 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const owner = await readRepoLock(repoRoot);
    if (owner !== undefined) {
      if (await ownerIsLive(owner)) {
        return { acquired: false, owner };
      }
    }
    // Unreadable or stale lock: remove and retry the atomic create once.
    await rm(lockPath(repoRoot), { force: true }).catch(() => undefined);
  }
  const owner = await readRepoLock(repoRoot);
  return owner !== undefined
    ? { acquired: false, owner }
    : { acquired: false, owner: { runId: "unknown", pid: -1, acquiredAt: now() } };
}

export async function readRepoLock(repoRoot: string): Promise<RepoLockOwner | undefined> {
  try {
    const raw = await readFile(lockPath(repoRoot), "utf8");
    const parsed = JSON.parse(raw) as Partial<RepoLockOwner>;
    if (typeof parsed.runId === "string" && typeof parsed.pid === "number") {
      return parsed as RepoLockOwner;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Release only when still owned by `runId` — never clobber a foreign lock. */
export async function releaseRepoLock(repoRoot: string, runId: string): Promise<void> {
  const owner = await readRepoLock(repoRoot);
  if (owner?.runId === runId) {
    await rm(lockPath(repoRoot), { force: true }).catch(() => undefined);
  }
}
