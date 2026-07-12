/**
 * U7 — one active pipeline per target repo.
 *
 * The lock acquisition is atomic (wx flag), blocks duplicate live owners,
 * steals stale locks (dead PID / silent owner), and never lets a foreign run
 * release someone else's lock. Preflight gains disk-space awareness and stops
 * counting ManyHands-owned artifacts as user dirt.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireRepoLock, readRepoLock, releaseRepoLease, withRepositoryLease } from "@/lib/server/runs/repo-lock";
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
  it("withRepositoryLease fences a competing Git mutation until the owner releases", async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const first = withRepositoryLease({ repoRoot, runId: "run-a" }, async () => {
      entered();
      await held;
    });
    await started;
    await expect(withRepositoryLease({ repoRoot, runId: "run-b" }, async () => undefined)).rejects.toThrow(
      /owned by run run-a/i
    );
    release();
    await first;
    await expect(withRepositoryLease({ repoRoot, runId: "run-b" }, async () => "mutated")).resolves.toBe("mutated");
  });

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

  it("blocks duplicate acquirers, including the same run, while the owner lives", async () => {
    expect((await acquireRepoLock(repoRoot, "run-a", { ownerIsLive: liveOwner })).acquired).toBe(true);
    const duplicate = await acquireRepoLock(repoRoot, "run-a", { ownerIsLive: liveOwner });
    expect(duplicate.acquired).toBe(false);
    expect((duplicate as { owner: { runId: string } }).owner.runId).toBe("run-a");
    const blocked = await acquireRepoLock(repoRoot, "run-b", { ownerIsLive: liveOwner });
    expect(blocked.acquired).toBe(false);
    expect((blocked as { owner: { runId: string } }).owner.runId).toBe("run-a");
  });

  it("steals a stale lock even when the stale owner has the same run id", async () => {
    expect((await acquireRepoLock(repoRoot, "run-a", { ownerIsLive: liveOwner })).acquired).toBe(true);
    const stolen = await acquireRepoLock(repoRoot, "run-a", { ownerIsLive: deadOwner });
    expect(stolen).toMatchObject({ acquired: true, stolen: true });
    expect((await readRepoLock(repoRoot))?.runId).toBe("run-a");
  });

  it("steals the lock of a dead owner and records the theft", async () => {
    await acquireRepoLock(repoRoot, "run-dead", { ownerIsLive: liveOwner });
    const stolen = await acquireRepoLock(repoRoot, "run-new", { ownerIsLive: deadOwner });
    expect(stolen).toMatchObject({ acquired: true, stolen: true });
    expect((await readRepoLock(repoRoot))?.runId).toBe("run-new");
  });

  it("steals an unreadable (corrupt) lock file", async () => {
    await mkdir(path.join(repoRoot, ".manyhands"), { recursive: true });
    await writeFile(path.join(repoRoot, ".manyhands", "run.lock"), "%%% garbage", "utf8");
    const result = await acquireRepoLock(repoRoot, "run-x", { ownerIsLive: liveOwner });
    expect(result.acquired).toBe(true);
  });

  it("release is lease-scoped: a foreign lease cannot clobber the lock", async () => {
    const held = await acquireRepoLock(repoRoot, "run-a", { ownerIsLive: liveOwner });
    if (!held.acquired) throw new Error("expected run-a to acquire");
    // A forged/foreign lease (wrong token) must be a no-op.
    await releaseRepoLease({ ...held.lease, runId: "run-b", token: "not-the-owner-token" });
    expect((await readRepoLock(repoRoot))?.runId).toBe("run-a");
    await releaseRepoLease(held.lease);
    expect(await readRepoLock(repoRoot)).toBeUndefined();
    // Released: the next acquirer wins cleanly.
    expect((await acquireRepoLock(repoRoot, "run-b", { ownerIsLive: liveOwner })).acquired).toBe(true);
  });

  it("lock owner contents survive a read round-trip", async () => {
    const held = await acquireRepoLock(repoRoot, "run-roundtrip", { ownerIsLive: liveOwner });
    if (!held.acquired) throw new Error("expected run-roundtrip to acquire");
    const owner = await readRepoLock(repoRoot);
    expect(owner?.runId).toBe("run-roundtrip");
    expect(owner?.pid).toBe(process.pid);
    expect(owner?.token).toBe(held.lease.token);
    expect(owner?.generation).toBe(held.lease.generation);
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
