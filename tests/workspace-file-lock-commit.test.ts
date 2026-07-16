import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withWorkspaceFileLock } from "@/lib/server/workspaces/file-lock";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("workspace file lock commit truth", () => {
  it("returns a committed result and lets the next owner acquire after release rename exhaustion", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-commit-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const releaseRename = async (): Promise<void> => {
      throw Object.assign(new Error("simulated release rename contention"), { code: "EBUSY" });
    };

    const committed = await withWorkspaceFileLock(
      filePath,
      async () => "committed",
      { releaseRename, retryMs: 1 }
    );
    expect(committed).toBe("committed");
    await expect(access(`${filePath}.lock/release-intent.json`)).resolves.toBeUndefined();

    const next = await withWorkspaceFileLock(
      filePath,
      async () => "next-owner",
      { acquireTimeoutMs: 2_000, staleMs: 60_000, retryMs: 1 }
    );
    expect(next).toBe("next-owner");
  });

  it("recovers a release-intent lock whose takeover owner died", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-dead-takeover-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const owner = {
      token: "committed-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    const deadPid = await exitedProcessPid();
    const takeoverOwner = {
      token: "dead-takeover-owner",
      pid: deadPid,
      acquiredAt: new Date().toISOString(),
      lockToken: owner.token
    };
    await seedReleasedLockWithTakeover(lockDir, owner, takeoverOwner);

    const acquired = await withWorkspaceFileLock(
      filePath,
      async () => "recovered",
      { acquireTimeoutMs: 2_000, staleMs: 60_000, retryMs: 1 }
    );

    expect(acquired).toBe("recovered");
    await expect(access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("adopts a release transition left live after committed cleanup failed", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-live-release-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const owner = {
      token: "committed-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    const releaseOwner = {
      token: "failed-release-transition",
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      lockToken: owner.token,
      purpose: "release" as const
    };
    await seedReleasedLockWithTakeover(lockDir, owner, releaseOwner);

    const acquired = await withWorkspaceFileLock(
      filePath,
      async () => "adopted-live-release",
      { acquireTimeoutMs: 2_000, staleMs: 60_000, retryMs: 1 }
    );

    expect(acquired).toBe("adopted-live-release");
    await expect(access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers when a dead claimant crashed after moving the old marker", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-claimed-crash-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const owner = {
      token: "committed-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    const claimedPath = path.join(lockDir, "takeover.claimed-crashed");
    const crashedPid = await exitedProcessPid();
    await mkdir(claimedPath, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner), "utf8");
    await writeFile(
      path.join(lockDir, "release-intent.json"),
      JSON.stringify({ token: owner.token, pid: owner.pid, releasedAt: new Date().toISOString() }),
      "utf8"
    );
    await writeFile(
      path.join(claimedPath, "owner.json"),
      JSON.stringify({
        token: "crashed-claimant",
        pid: crashedPid,
        acquiredAt: new Date().toISOString(),
        lockToken: owner.token,
        purpose: "takeover"
      }),
      "utf8"
    );
    await writeFile(
      `${claimedPath}.claim.json`,
      JSON.stringify({
        token: "crashed-claimant",
        pid: crashedPid,
        acquiredAt: new Date().toISOString(),
        lockToken: owner.token,
        purpose: "takeover"
      }),
      "utf8"
    );

    await expect(withWorkspaceFileLock(
      filePath,
      async () => "recovered-claim-gap",
      { acquireTimeoutMs: 2_000, staleMs: 60_000, retryMs: 1 }
    )).resolves.toBe("recovered-claim-gap");
    await expect(access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows only one challenger to claim a dead marker and preserves the fresh owner", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-dead-contention-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const owner = {
      token: "committed-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    const takeoverOwner = {
      token: "dead-takeover-owner",
      pid: await exitedProcessPid(),
      acquiredAt: new Date().toISOString(),
      lockToken: owner.token
    };
    await seedReleasedLockWithTakeover(lockDir, owner, takeoverOwner);
    let active = 0;
    let maxActive = 0;
    const contend = (name: string) => withWorkspaceFileLock(
      filePath,
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const freshOwner = await readFile(path.join(lockDir, "owner.json"), "utf8");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await readFile(path.join(lockDir, "owner.json"), "utf8")).toBe(freshOwner);
        active -= 1;
        return name;
      },
      { acquireTimeoutMs: 3_000, staleMs: 60_000, retryMs: 1 }
    );

    await expect(Promise.all([contend("one"), contend("two")]))
      .resolves.toEqual(expect.arrayContaining(["one", "two"]));
    expect(maxActive).toBe(1);
    await expect(access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a stale marker claim before three challengers can move a fresh owner", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-stale-claim-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const owner = {
      token: "committed-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    const takeoverOwner = {
      token: "dead-takeover-owner",
      pid: await exitedProcessPid(),
      acquiredAt: new Date().toISOString(),
      lockToken: owner.token
    };
    await seedReleasedLockWithTakeover(lockDir, owner, takeoverOwner);

    const bPrecheckedOldMarker = deferred<void>();
    const allowBStaleRename = deferred<void>();
    const bMovedReplacement = deferred<void>();
    const allowBPostcheck = deferred<void>();
    const aValidatedReplacement = deferred<void>();
    const allowAQuarantine = deferred<void>();
    const cBlockedByLiveClaim = deferred<void>();
    const bRejectedStaleClaim = deferred<void>();
    let bClaimRenames = 0;
    let active = 0;
    let maxActive = 0;
    const enter = async (name: string): Promise<string> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const freshOwner = await readFile(path.join(lockDir, "owner.json"), "utf8");
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(await readFile(path.join(lockDir, "owner.json"), "utf8")).toBe(freshOwner);
      active -= 1;
      return name;
    };

    // B validates the original dead marker first, but pauses before rename.
    const b = withWorkspaceFileLock(filePath, () => enter("B"), {
      acquireTimeoutMs: 4_000,
      staleMs: 60_000,
      retryMs: 1,
      beforeClaimRename: async () => {
        bPrecheckedOldMarker.resolve(undefined);
        await allowBStaleRename.promise;
      },
      afterClaimRename: async () => {
        bClaimRenames += 1;
        if (bClaimRenames !== 1) return;
        bMovedReplacement.resolve(undefined);
        await allowBPostcheck.promise;
      },
      afterClaimIdentityMismatch: async () => bRejectedStaleClaim.resolve(undefined)
    });
    await bPrecheckedOldMarker.promise;

    // A claims that marker, publishes its replacement, validates it, and
    // pauses at the last pre-quarantine boundary.
    const a = withWorkspaceFileLock(filePath, () => enter("A"), {
      acquireTimeoutMs: 4_000,
      staleMs: 60_000,
      retryMs: 1,
      beforeQuarantineRename: async () => {
        aValidatedReplacement.resolve(undefined);
        await allowAQuarantine.promise;
      }
    });
    await aValidatedReplacement.promise;

    // C is the fresh waiter that the stale B claim used to be able to move
    // after A freed the canonical path.
    const c = withWorkspaceFileLock(filePath, () => enter("C"), {
      acquireTimeoutMs: 4_000,
      staleMs: 60_000,
      retryMs: 1,
      afterForeignClaimBlocked: async () => cBlockedByLiveClaim.resolve(undefined)
    });
    allowBStaleRename.resolve(undefined);
    await bMovedReplacement.promise;
    await cBlockedByLiveClaim.promise;
    allowBPostcheck.resolve(undefined);
    await bRejectedStaleClaim.promise;
    allowAQuarantine.resolve(undefined);

    await expect(Promise.all([a, b, c])).resolves.toEqual(
      expect.arrayContaining(["A", "B", "C"])
    );
    expect(maxActive).toBe(1);
    await expect(access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a stale corrupt takeover marker without deleting it in place", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-stale-takeover-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const owner = {
      token: "committed-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    await mkdir(path.join(lockDir, "takeover"), { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner), "utf8");
    await writeFile(
      path.join(lockDir, "release-intent.json"),
      JSON.stringify({ token: owner.token, pid: owner.pid, releasedAt: new Date().toISOString() }),
      "utf8"
    );
    await writeFile(path.join(lockDir, "takeover", "owner.json"), "{corrupt", "utf8");
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(lockDir, "takeover"), old, old);

    const acquired = await withWorkspaceFileLock(
      filePath,
      async () => "recovered-stale",
      { acquireTimeoutMs: 2_000, staleMs: 10, retryMs: 1 }
    );

    expect(acquired).toBe("recovered-stale");
    await expect(access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not remove an active takeover marker owned by another challenger", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-active-takeover-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const owner = {
      token: "committed-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    const takeoverOwner = {
      token: "active-takeover-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      lockToken: owner.token
    };
    await seedReleasedLockWithTakeover(lockDir, owner, takeoverOwner);

    await expect(withWorkspaceFileLock(
      filePath,
      async () => "must-not-run",
      { acquireTimeoutMs: 30, staleMs: 60_000, retryMs: 1 }
    )).rejects.toThrow("Timed out waiting for the workspace store lock");

    await expect(
      readFile(path.join(lockDir, "takeover", "owner.json"), "utf8")
    ).resolves.toBe(JSON.stringify(takeoverOwner));
  });

  it("recovers the stale raw takeover marker written by the legacy protocol", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-legacy-takeover-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const owner = {
      token: "legacy-committed-owner",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner), "utf8");
    await writeFile(
      path.join(lockDir, "release-intent.json"),
      JSON.stringify({ token: owner.token, pid: owner.pid, releasedAt: new Date().toISOString() }),
      "utf8"
    );
    const legacyTakeoverPath = path.join(lockDir, "takeover");
    await writeFile(legacyTakeoverPath, "999999:legacy-challenger-token", "utf8");
    const old = new Date(Date.now() - 60_000);
    await utimes(legacyTakeoverPath, old, old);

    const acquired = await withWorkspaceFileLock(
      filePath,
      async () => "recovered-legacy",
      { acquireTimeoutMs: 2_000, staleMs: 10, retryMs: 1 }
    );

    expect(acquired).toBe("recovered-legacy");
    await expect(access(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("linearizes release against takeover before either can move the lock path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-lock-transition-race-"));
    const filePath = path.join(tempDir, "workspaces.json");
    const lockDir = `${filePath}.lock`;
    const takeoverPublished = deferred<void>();
    const allowTakeover = deferred<void>();
    let releaseRenameCalls = 0;
    let challenger: Promise<string> | undefined;

    const committed = await withWorkspaceFileLock(
      filePath,
      async () => {
        const owner = JSON.parse(
          await readFile(path.join(lockDir, "owner.json"), "utf8")
        ) as { token: string; pid: number };
        await writeFile(
          path.join(lockDir, "release-intent.json"),
          JSON.stringify({
            token: owner.token,
            pid: owner.pid,
            releasedAt: new Date().toISOString()
          }),
          "utf8"
        );
        challenger = withWorkspaceFileLock(
          filePath,
          async () => {
            const freshOwner = await readFile(path.join(lockDir, "owner.json"), "utf8");
            await new Promise((resolve) => setTimeout(resolve, 300));
            await expect(readFile(path.join(lockDir, "owner.json"), "utf8"))
              .resolves.toBe(freshOwner);
            return "fresh-owner-survived";
          },
          {
            acquireTimeoutMs: 2_000,
            staleMs: 60_000,
            retryMs: 1,
            beforeQuarantineRename: async () => {
              takeoverPublished.resolve(undefined);
              await allowTakeover.promise;
            }
          }
        );
        await takeoverPublished.promise;
        return "committed-before-takeover";
      },
      {
        releaseRename: async (from, to) => {
          releaseRenameCalls += 1;
          await rm(to, { recursive: true, force: true });
          throw Object.assign(new Error(`unexpected release rename ${from}`), { code: "EBUSY" });
        }
      }
    );

    expect(committed).toBe("committed-before-takeover");
    expect(releaseRenameCalls).toBe(0);
    allowTakeover.resolve(undefined);
    await expect(challenger).resolves.toBe("fresh-owner-survived");
  });
});

async function seedReleasedLockWithTakeover(
  lockDir: string,
  owner: { token: string; pid: number; acquiredAt: string },
  takeoverOwner: {
    token: string;
    pid: number;
    acquiredAt: string;
    lockToken: string | null;
    purpose?: "takeover" | "release";
  }
): Promise<void> {
  await mkdir(path.join(lockDir, "takeover"), { recursive: true });
  await writeFile(path.join(lockDir, "owner.json"), JSON.stringify(owner), "utf8");
  await writeFile(
    path.join(lockDir, "release-intent.json"),
    JSON.stringify({ token: owner.token, pid: owner.pid, releasedAt: new Date().toISOString() }),
    "utf8"
  );
  await writeFile(
    path.join(lockDir, "takeover", "owner.json"),
    JSON.stringify(takeoverOwner),
    "utf8"
  );
}

async function exitedProcessPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("Could not obtain child PID for takeover recovery test");
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
  return pid;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
