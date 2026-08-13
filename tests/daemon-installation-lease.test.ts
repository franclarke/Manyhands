import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireInstallationLease,
  InstallationLeaseUnavailableError,
  type ProcessIdentityStatus
} from "../apps/daemon/src/installation-lease.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("installation ownership lease", () => {
  it("publishes a complete owner before returning an authoritative lease", async () => {
    const root = await createTemporaryDirectory();
    const leaseDirectory = path.join(root, "installation-owner");

    const lease = await acquireInstallationLease(leaseDirectory, {
      pid: 4101,
      processStartIdentity: "process-start:a",
      processIdentityProbe: {
        async probe() {
          return "same";
        }
      },
      createNonce: () => "nonce:a",
      createDaemonEpoch: () => "daemon-epoch:a",
      now: () => new Date("2026-08-12T12:00:00.000Z")
    });

    expect(JSON.parse(await readFile(path.join(leaseDirectory, "owner.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      pid: 4101,
      processStartIdentity: "process-start:a",
      nonce: "nonce:a",
      daemonEpoch: "daemon-epoch:a",
      acquiredAt: "2026-08-12T12:00:00.000Z"
    });
    expect(lease.owner).toEqual({
      schemaVersion: 1,
      pid: 4101,
      processStartIdentity: "process-start:a",
      nonce: "nonce:a",
      daemonEpoch: "daemon-epoch:a",
      acquiredAt: "2026-08-12T12:00:00.000Z"
    });
    await expect(lease.assertCurrent()).resolves.toBeUndefined();
  });

  it.each<ProcessIdentityStatus>(["same", "unknown"])(
    "fails closed when the recorded process identity is %s",
    async (identityStatus) => {
      const root = await createTemporaryDirectory();
      const leaseDirectory = path.join(root, "installation-owner");
      const incumbent = await acquireInstallationLease(
        leaseDirectory,
        ownerOptions("a", {
          async probe() {
            return "same";
          }
        })
      );

      const attempted = acquireInstallationLease(
        leaseDirectory,
        ownerOptions("b", {
          async probe(owner) {
            expect(owner).toEqual({
              pid: incumbent.owner.pid,
              processStartIdentity: incumbent.owner.processStartIdentity
            });
            return identityStatus;
          }
        })
      );

      await expect(attempted).rejects.toMatchObject({
        name: InstallationLeaseUnavailableError.name,
        status: identityStatus,
        currentOwner: incumbent.owner
      });
      await expect(incumbent.assertCurrent()).resolves.toBeUndefined();
    }
  );

  it.each<ProcessIdentityStatus>(["different", "dead"])(
    "atomically takes over an owner whose process identity is %s",
    async (identityStatus) => {
      const root = await createTemporaryDirectory();
      const leaseDirectory = path.join(root, "installation-owner");
      const incumbent = await acquireInstallationLease(
        leaseDirectory,
        ownerOptions("a", {
          async probe() {
            return "same";
          }
        })
      );

      const successor = await acquireInstallationLease(
        leaseDirectory,
        ownerOptions("b", {
          async probe(owner) {
            expect(owner).toEqual({ pid: 4101, processStartIdentity: "process-start:a" });
            return identityStatus;
          }
        })
      );

      expect(successor.owner.nonce).toBe("nonce:b");
      await expect(successor.assertCurrent()).resolves.toBeUndefined();
      await expect(incumbent.assertCurrent()).rejects.toThrow("no longer current");
      expect(await readdir(root)).toEqual(["installation-owner"]);
    }
  );

  it("never lets a late release delete the successor generation", async () => {
    const root = await createTemporaryDirectory();
    const leaseDirectory = path.join(root, "installation-owner");
    const incumbent = await acquireInstallationLease(
      leaseDirectory,
      ownerOptions("a", { async probe() { return "same"; } })
    );
    const successor = await acquireInstallationLease(
      leaseDirectory,
      ownerOptions("b", { async probe() { return "dead"; } })
    );

    await incumbent.release();

    await expect(successor.assertCurrent()).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path.join(leaseDirectory, "owner.json"), "utf8")))
      .toEqual(successor.owner);
  });

  it("elects exactly one owner when contenders start concurrently", async () => {
    const root = await createTemporaryDirectory();
    const leaseDirectory = path.join(root, "installation-owner");
    const attempts = Array.from({ length: 12 }, (_, index) => {
      const id = `contender-${index}`;
      return acquireInstallationLease(leaseDirectory, {
        pid: 5000 + index,
        processStartIdentity: `process-start:${id}`,
        processIdentityProbe: {
          async probe() {
            return "same";
          }
        },
        createNonce: () => `nonce:${id}`,
        createDaemonEpoch: () => `daemon-epoch:${id}`,
        now: () => new Date(`2026-08-12T12:01:${String(index).padStart(2, "0")}.000Z`)
      });
    });

    const settled = await Promise.allSettled(attempts);
    const winners = settled.filter(
      (result): result is PromiseFulfilledResult<Awaited<(typeof attempts)[number]>> =>
        result.status === "fulfilled"
    );

    expect(winners).toHaveLength(1);
    await expect(winners[0]!.value.assertCurrent()).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path.join(leaseDirectory, "owner.json"), "utf8")))
      .toEqual(winners[0]!.value.owner);
    expect((await readdir(root)).filter((entry) => entry.includes(".staging-"))).toEqual([]);
  });

  it("elects one successor when contenders concurrently reclaim the same dead owner", async () => {
    const root = await createTemporaryDirectory();
    const leaseDirectory = path.join(root, "installation-owner");
    const incumbent = await acquireInstallationLease(
      leaseDirectory,
      ownerOptions("a", { async probe() { return "same"; } })
    );
    const contenderCount = 8;
    let observedIncumbent = 0;
    let releaseProbeBarrier!: () => void;
    const probeBarrier = new Promise<void>((resolve) => {
      releaseProbeBarrier = resolve;
    });

    const attempts = Array.from({ length: contenderCount }, (_, index) =>
      acquireInstallationLease(leaseDirectory, {
        pid: 6000 + index,
        processStartIdentity: `process-start:reclaimer-${index}`,
        processIdentityProbe: {
          async probe(owner) {
            if (owner.pid !== incumbent.owner.pid) return "same";
            observedIncumbent += 1;
            if (observedIncumbent === contenderCount) releaseProbeBarrier();
            await probeBarrier;
            return "dead";
          }
        },
        createNonce: () => `nonce:reclaimer-${index}`,
        createDaemonEpoch: () => `daemon-epoch:reclaimer-${index}`,
        now: () => new Date(`2026-08-12T12:02:${String(index).padStart(2, "0")}.000Z`)
      })
    );

    const settled = await Promise.allSettled(attempts);
    const winners = settled.filter(
      (result): result is PromiseFulfilledResult<Awaited<(typeof attempts)[number]>> =>
        result.status === "fulfilled"
    );

    expect(observedIncumbent).toBe(contenderCount);
    expect(winners).toHaveLength(1);
    await incumbent.release();
    await expect(winners[0]!.value.assertCurrent()).resolves.toBeUndefined();
  });

  it("fails closed without probing a malformed owner record", async () => {
    const root = await createTemporaryDirectory();
    const leaseDirectory = path.join(root, "installation-owner");
    await mkdir(leaseDirectory);
    await writeFile(
      path.join(leaseDirectory, "owner.json"),
      JSON.stringify({
        schemaVersion: 1,
        pid: 4101,
        processStartIdentity: "process-start:a",
        nonce: "nonce:a",
        daemonEpoch: "daemon-epoch:a",
        acquiredAt: "2026-08-12T12:00:00.000Z",
        unexpected: true
      })
    );
    let probeCalls = 0;

    await expect(acquireInstallationLease(leaseDirectory, {
      ...ownerOptions("b", {
        async probe() {
          probeCalls += 1;
          return "dead";
        }
      })
    })).rejects.toMatchObject({
      name: InstallationLeaseUnavailableError.name,
      status: "unknown"
    });
    expect(probeCalls).toBe(0);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "manyhands-daemon-lease-"));
  temporaryDirectories.push(directory);
  return directory;
}

function ownerOptions(
  id: string,
  processIdentityProbe: {
    probe(owner: { pid: number; processStartIdentity: string }): Promise<ProcessIdentityStatus>;
  }
) {
  return {
    pid: id === "a" ? 4101 : 4102,
    processStartIdentity: `process-start:${id}`,
    processIdentityProbe,
    createNonce: () => `nonce:${id}`,
    createDaemonEpoch: () => `daemon-epoch:${id}`,
    now: () => new Date(`2026-08-12T12:00:0${id === "a" ? "0" : "1"}.000Z`)
  };
}
