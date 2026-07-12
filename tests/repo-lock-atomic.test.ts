/**
 * B-004 — atomic repo lock (CF-04).
 *
 * The old lock allowed two owners: stale takeover was read -> rm -> create
 * (a loser's rm could delete the new winner's lock) and release was
 * read-then-remove keyed only by runId (a late release from a previous
 * incarnation of the same run deleted the current lock). This suite pins the
 * hardened semantics:
 *
 *  - every acquisition carries an immutable token and a monotonic generation
 *    (fencing token) scoped to the git common directory;
 *  - stale takeover is atomic: N contenders over a stale lock produce exactly
 *    one valid owner;
 *  - release/renew/fencing verify the token — an old lease can never delete
 *    or refresh the current lock;
 *  - liveness uses the lock heartbeat first, never only PID + timestamps;
 *  - two paths into the same repository (linked worktree) contend on one lock.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RepoLeaseLostError,
  acquireRepoLock,
  assertRepoLeaseCurrent,
  readRepoLock,
  releaseRepoLease,
  renewRepoLease,
  startRepoLeaseHeartbeat,
  type RepoLease,
  type RepoLockOwner
} from "@/lib/server/runs/repo-lock";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-lock-b004-"));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
});

const liveOwner = async (): Promise<boolean> => true;
const deadOwner = async (): Promise<boolean> => false;

function lockDirOf(root: string): string {
  return path.join(root, ".manyhands", "run.lock");
}

async function acquireOrFail(root: string, runId: string, deps?: Parameters<typeof acquireRepoLock>[2]): Promise<RepoLease> {
  const result = await acquireRepoLock(root, runId, deps);
  if (!result.acquired) throw new Error(`expected ${runId} to acquire the lock`);
  return result.lease;
}

async function spawnDeadPid(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", () => resolve(child.pid ?? -1));
  });
}

describe("B-004 repo lock: token + generation", () => {
  it("acquisition mints an immutable token and a monotonically increasing generation", async () => {
    const first = await acquireOrFail(repoRoot, "run-a", { ownerIsLive: liveOwner });
    expect(first.token).toMatch(/[0-9a-f-]{8,}/i);
    expect(first.generation).toBeGreaterThanOrEqual(1);
    await releaseRepoLease(first);

    const second = await acquireOrFail(repoRoot, "run-b", { ownerIsLive: liveOwner });
    expect(second.token).not.toBe(first.token);
    expect(second.generation).toBeGreaterThan(first.generation);

    // Takeover (owner reported dead) also advances the generation.
    const third = await acquireOrFail(repoRoot, "run-c", { ownerIsLive: deadOwner });
    expect(third.generation).toBeGreaterThan(second.generation);
    await releaseRepoLease(third);
  });

  it("a late release from a previous incarnation of the same run never deletes the current lock", async () => {
    const oldLease = await acquireOrFail(repoRoot, "run-a", { ownerIsLive: liveOwner });
    // The run crashes and restarts: same runId steals its own stale lock.
    const newLease = await acquireOrFail(repoRoot, "run-a", { ownerIsLive: deadOwner });
    expect(newLease.token).not.toBe(oldLease.token);

    // The zombie's deferred release fires afterwards. It must be a no-op.
    await releaseRepoLease(oldLease);
    const owner = await readRepoLock(repoRoot);
    expect(owner?.token).toBe(newLease.token);

    // The real owner can still release normally.
    await releaseRepoLease(newLease);
    expect(await readRepoLock(repoRoot)).toBeUndefined();
  });

  it("release verifies ownership even when the lock changed between read and remove", async () => {
    const lease = await acquireOrFail(repoRoot, "run-a", { ownerIsLive: liveOwner });
    // Simulate a takeover that happened while the old owner was suspended.
    await rename(lockDirOf(repoRoot), `${lockDirOf(repoRoot)}.hijack`);
    const usurper = await acquireOrFail(repoRoot, "run-b", { ownerIsLive: deadOwner });

    await releaseRepoLease(lease);
    expect((await readRepoLock(repoRoot))?.token).toBe(usurper.token);
    await releaseRepoLease(usurper);
  });
});

describe("B-004 repo lock: atomic acquire and stale takeover", () => {
  it("of N concurrent fresh acquirers exactly one wins", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => acquireRepoLock(repoRoot, `run-${i}`, { ownerIsLive: liveOwner }))
    );
    const winners = results.filter((r) => r.acquired);
    expect(winners).toHaveLength(1);
  });

  it("N concurrent contenders over a stale lock produce exactly one valid owner (every round)", async () => {
    // Only the original stale owner is dead; any new winner is live. This is
    // the CF-04 window: with read -> rm -> create, a straggler's rm deletes
    // the new winner's lock and two contenders both believe they own it.
    const staleOnly = async (owner: RepoLockOwner): Promise<boolean> => owner.runId !== "stale-run";

    for (let round = 0; round < 6; round += 1) {
      const root = await mkdtemp(path.join(os.tmpdir(), `mh-lock-race-${round}-`));
      try {
        const stale = await acquireOrFail(root, "stale-run", { ownerIsLive: liveOwner });
        expect(stale.runId).toBe("stale-run");

        const contenders = await Promise.all(
          Array.from({ length: 16 }, (_, i) =>
            acquireRepoLock(root, `contender-${i}`, { ownerIsLive: staleOnly })
          )
        );
        const winners = contenders.filter((r) => r.acquired) as Array<{ acquired: true; lease: RepoLease }>;
        expect(winners).toHaveLength(1);

        const onDisk = await readRepoLock(root);
        expect(onDisk?.token).toBe(winners[0]!.lease.token);
        expect(onDisk?.generation).toBe(winners[0]!.lease.generation);
        expect(onDisk!.generation).toBeGreaterThan(stale.generation);
      } finally {
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }, 60_000);

  it("honors a live legacy file-format lock and steals it atomically when stale", async () => {
    await mkdir(path.join(repoRoot, ".manyhands"), { recursive: true });
    await writeFile(
      lockDirOf(repoRoot),
      JSON.stringify({ runId: "legacy-run", pid: 12345, acquiredAt: new Date().toISOString() }),
      "utf8"
    );

    const blocked = await acquireRepoLock(repoRoot, "run-new", { ownerIsLive: liveOwner });
    expect(blocked.acquired).toBe(false);
    if (!blocked.acquired) expect(blocked.owner.runId).toBe("legacy-run");

    const stolen = await acquireRepoLock(repoRoot, "run-new", { ownerIsLive: deadOwner });
    expect(stolen.acquired).toBe(true);
    if (stolen.acquired) {
      expect(stolen.stolen).toBe(true);
      const owner = await readRepoLock(repoRoot);
      expect(owner?.runId).toBe("run-new");
      expect(owner?.generation).toBeGreaterThanOrEqual(1);
      await releaseRepoLease(stolen.lease);
    }
  });

  it("steals an unreadable (corrupt) lock", async () => {
    await mkdir(path.join(repoRoot, ".manyhands"), { recursive: true });
    await writeFile(lockDirOf(repoRoot), "%%% garbage", "utf8");
    const result = await acquireRepoLock(repoRoot, "run-x", { ownerIsLive: liveOwner });
    expect(result.acquired).toBe(true);
    if (result.acquired) await releaseRepoLease(result.lease);
  });
});

describe("B-004 repo lock: heartbeat", () => {
  it("renew refreshes the lease heartbeat; a superseded lease cannot renew", async () => {
    const lease = await acquireOrFail(repoRoot, "run-a", { ownerIsLive: liveOwner });
    const renewed = await renewRepoLease(lease);
    expect(renewed.ok).toBe(true);

    const usurper = await acquireOrFail(repoRoot, "run-b", { ownerIsLive: deadOwner });
    const late = await renewRepoLease(lease);
    expect(late.ok).toBe(false);
    expect((await readRepoLock(repoRoot))?.token).toBe(usurper.token);
    await releaseRepoLease(usurper);
  });

  it("startRepoLeaseHeartbeat renews periodically until stopped", async () => {
    const lease = await acquireOrFail(repoRoot, "run-a", { ownerIsLive: liveOwner });
    const beats: string[] = [];
    const stop = startRepoLeaseHeartbeat(lease, {
      intervalMs: 25,
      onBeat: (at) => beats.push(at)
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    stop();
    expect(beats.length).toBeGreaterThanOrEqual(2);
    const settled = beats.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(beats.length).toBe(settled);
    await releaseRepoLease(lease);
  });

  it("default liveness trusts a fresh lock heartbeat over a dead PID, and steals once the heartbeat is stale", async () => {
    const deadPid = await spawnDeadPid();
    const lockDir = lockDirOf(repoRoot);
    await mkdir(lockDir, { recursive: true });
    const token = "11111111-2222-3333-4444-555555555555";
    await writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({
        runId: "foreign-run",
        pid: deadPid,
        token,
        generation: 7,
        acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      }),
      "utf8"
    );
    // Fresh heartbeat: owner must be considered live even though its PID is dead.
    await writeFile(
      path.join(lockDir, `heartbeat-${token}.json`),
      JSON.stringify({ token, at: new Date().toISOString() }),
      "utf8"
    );
    const blocked = await acquireRepoLock(repoRoot, "run-new");
    expect(blocked.acquired).toBe(false);

    // Stale heartbeat + dead PID: now it is genuinely orphaned.
    await writeFile(
      path.join(lockDir, `heartbeat-${token}.json`),
      JSON.stringify({ token, at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
      "utf8"
    );
    const stolen = await acquireRepoLock(repoRoot, "run-new");
    expect(stolen.acquired).toBe(true);
    if (stolen.acquired) {
      expect(stolen.lease.generation).toBeGreaterThan(7);
      await releaseRepoLease(stolen.lease);
    }
  });
});

describe("B-004 repo lock: fencing", () => {
  it("assertRepoLeaseCurrent passes for the active lease and throws RepoLeaseLostError for a superseded one", async () => {
    const lease = await acquireOrFail(repoRoot, "run-a", { ownerIsLive: liveOwner });
    await expect(assertRepoLeaseCurrent(lease)).resolves.toBeUndefined();

    const usurper = await acquireOrFail(repoRoot, "run-b", { ownerIsLive: deadOwner });
    await expect(assertRepoLeaseCurrent(lease)).rejects.toBeInstanceOf(RepoLeaseLostError);
    await expect(assertRepoLeaseCurrent(usurper)).resolves.toBeUndefined();

    await releaseRepoLease(usurper);
    await expect(assertRepoLeaseCurrent(usurper)).rejects.toBeInstanceOf(RepoLeaseLostError);
  });
});

describe("B-004 repo lock: git common directory keying", () => {
  async function git(cwd: string, ...args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", args, { cwd, stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`git ${args.join(" ")} exited ${code}`))
      );
    });
  }

  it("two paths into the same repository (linked worktree) contend on one lock", async () => {
    const mainRoot = path.join(repoRoot, "main");
    await mkdir(mainRoot, { recursive: true });
    await git(mainRoot, "init", "-b", "main");
    await git(mainRoot, "config", "user.email", "t@example.com");
    await git(mainRoot, "config", "user.name", "t");
    await writeFile(path.join(mainRoot, "file.txt"), "x", "utf8");
    await git(mainRoot, "add", ".");
    await git(mainRoot, "commit", "-m", "init");
    const worktreePath = path.join(repoRoot, "wt");
    await git(mainRoot, "worktree", "add", worktreePath, "-b", "wt-branch");

    const viaWorktree = await acquireOrFail(worktreePath, "run-wt", { ownerIsLive: liveOwner });
    const viaMain = await acquireRepoLock(mainRoot, "run-main", { ownerIsLive: liveOwner });
    expect(viaMain.acquired).toBe(false);
    if (!viaMain.acquired) expect(viaMain.owner.runId).toBe("run-wt");

    await releaseRepoLease(viaWorktree);
    const after = await acquireRepoLock(mainRoot, "run-main", { ownerIsLive: liveOwner });
    expect(after.acquired).toBe(true);
    if (after.acquired) await releaseRepoLease(after.lease);
  }, 30_000);
});

describe("B-004 repo lock: crash residue", () => {
  it("a lock directory without owner.json older than the grace window is treated as stale", async () => {
    const lockDir = lockDirOf(repoRoot);
    await mkdir(lockDir, { recursive: true });
    // Backdate the directory beyond the acquire grace window.
    const old = new Date(Date.now() - 60_000);
    const { utimes } = await import("node:fs/promises");
    await utimes(lockDir, old, old);
    await stat(lockDir);

    const result = await acquireRepoLock(repoRoot, "run-x", { ownerIsLive: liveOwner });
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect((await readFile(path.join(lockDir, "owner.json"), "utf8")).length).toBeGreaterThan(0);
      await releaseRepoLease(result.lease);
    }
  });
});
