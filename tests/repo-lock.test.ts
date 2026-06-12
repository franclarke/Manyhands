/**
 * U7 — one active pipeline per target repo.
 *
 * The lock acquisition is atomic (wx flag), re-entrant for the owning run,
 * steals stale locks (dead PID / silent owner), and never lets a foreign run
 * release someone else's lock. Preflight gains disk-space awareness and stops
 * counting ManyHands-owned artifacts as user dirt.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireRepoLock, readRepoLock, releaseRepoLock } from "@/lib/server/runs/repo-lock";
import { PreflightError, runPreflight } from "@/lib/server/runs/preflight";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-lock-"));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
});

const liveOwner = async (): Promise<boolean> => true;
const deadOwner = async (): Promise<boolean> => false;

describe("repo lock", () => {
  it("of N concurrent acquirers exactly one wins", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => acquireRepoLock(repoRoot, `run-${i}`, { ownerIsLive: liveOwner }))
    );
    const winners = results.filter((r) => r.acquired);
    expect(winners).toHaveLength(1);
    const losers = results.filter((r) => !r.acquired) as Array<{ acquired: false; owner: { runId: string } }>;
    expect(losers).toHaveLength(4);
    const owner = await readRepoLock(repoRoot);
    for (const loser of losers) {
      expect(loser.owner.runId).toBe(owner?.runId);
    }
  });

  it("is re-entrant for the owning run and blocked for others while the owner lives", async () => {
    expect((await acquireRepoLock(repoRoot, "run-a", { ownerIsLive: liveOwner })).acquired).toBe(true);
    expect((await acquireRepoLock(repoRoot, "run-a", { ownerIsLive: liveOwner })).acquired).toBe(true);
    const blocked = await acquireRepoLock(repoRoot, "run-b", { ownerIsLive: liveOwner });
    expect(blocked.acquired).toBe(false);
    expect((blocked as { owner: { runId: string } }).owner.runId).toBe("run-a");
  });

  it("steals the lock of a dead owner and records the theft", async () => {
    await acquireRepoLock(repoRoot, "run-dead", { ownerIsLive: liveOwner });
    const stolen = await acquireRepoLock(repoRoot, "run-new", { ownerIsLive: deadOwner });
    expect(stolen).toEqual({ acquired: true, stolen: true });
    expect((await readRepoLock(repoRoot))?.runId).toBe("run-new");
  });

  it("steals an unreadable (corrupt) lock file", async () => {
    await mkdir(path.join(repoRoot, ".manyhands"), { recursive: true });
    await writeFile(path.join(repoRoot, ".manyhands", "run.lock"), "%%% garbage", "utf8");
    const result = await acquireRepoLock(repoRoot, "run-x", { ownerIsLive: liveOwner });
    expect(result.acquired).toBe(true);
  });

  it("release is owner-scoped: a foreign run cannot clobber the lock", async () => {
    await acquireRepoLock(repoRoot, "run-a", { ownerIsLive: liveOwner });
    await releaseRepoLock(repoRoot, "run-b");
    expect((await readRepoLock(repoRoot))?.runId).toBe("run-a");
    await releaseRepoLock(repoRoot, "run-a");
    expect(await readRepoLock(repoRoot)).toBeUndefined();
    // Released: the next acquirer wins cleanly.
    expect((await acquireRepoLock(repoRoot, "run-b", { ownerIsLive: liveOwner })).acquired).toBe(true);
  });

  it("lock file contents survive a read round-trip", async () => {
    await acquireRepoLock(repoRoot, "run-roundtrip", { ownerIsLive: liveOwner });
    const raw = JSON.parse(await readFile(path.join(repoRoot, ".manyhands", "run.lock"), "utf8")) as {
      runId: string;
      pid: number;
    };
    expect(raw.runId).toBe("run-roundtrip");
    expect(raw.pid).toBe(process.pid);
  });
});

describe("preflight hardening", () => {
  const baseDeps = {
    checkCli: async () => true,
    hasCredentials: () => true,
    branchExists: async () => true
  };
  const input = { repoRoot: "C:/fake/repo", baseBranch: "main" };

  it("ignores .manyhands/ artifacts in the repo-clean check (restart must pass its own preflight)", async () => {
    await expect(
      runPreflight(input, {
        ...baseDeps,
        gitPorcelain: async () => "?? .manyhands/worktrees/run-1/\n?? .manyhands/run.lock\n",
        freeDiskBytes: async () => 50 * 1024 * 1024 * 1024
      })
    ).resolves.toMatchObject({ warnings: expect.any(Array) });
  });

  it("still fails on real user dirt", async () => {
    await expect(
      runPreflight(input, {
        ...baseDeps,
        gitPorcelain: async () => " M src/index.ts\n?? .manyhands/run.lock\n",
        freeDiskBytes: async () => 50 * 1024 * 1024 * 1024
      })
    ).rejects.toMatchObject({ check: "repo_clean" });
  });

  it("fails with an actionable disk_space error below the threshold", async () => {
    const error = await runPreflight(input, {
      ...baseDeps,
      gitPorcelain: async () => "",
      freeDiskBytes: async () => 100 * 1024 * 1024 // 100 MB
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreflightError);
    expect((error as PreflightError).check).toBe("disk_space");
    expect((error as PreflightError).message).toContain("100 MB");
  });

  it("skips the disk check when the probe is unavailable", async () => {
    await expect(
      runPreflight(input, {
        ...baseDeps,
        gitPorcelain: async () => "",
        freeDiskBytes: async () => undefined
      })
    ).resolves.toMatchObject({ warnings: expect.any(Array) });
  });
});
