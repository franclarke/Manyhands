import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withTransitionalRepositoryLease } from "../apps/daemon/src/transitional-repository-lease.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("Stage 8 transitional repository lease", () => {
  it("takes over a fresh heartbeat when its owning process is already dead", async () => {
    const root = await temporaryDirectory();
    const lock = path.join(root, ".manyhands", "run.lock");
    const token = "dead-owner-token";
    await mkdir(lock, { recursive: true });
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      runId: "run:dead-owner",
      pid: 999_999,
      token,
      generation: 1,
      acquiredAt: new Date().toISOString()
    }), "utf8");
    await writeFile(path.join(lock, `heartbeat-${token}.json`), JSON.stringify({
      token,
      at: new Date().toISOString()
    }), "utf8");

    await expect(withTransitionalRepositoryLease({ repoRoot: root, runId: "run:recovered" }, async () => "recovered"))
      .resolves.toBe("recovered");
  });

  it("does not publish operation success when releasing the live daemon lease fails", async () => {
    const root = await temporaryDirectory();

    await expect(withTransitionalRepositoryLease({ repoRoot: root, runId: "run:release-failure" }, async () => {
      await createReleaseConflict(root);
      return "must-not-publish";
    })).rejects.toBeDefined();

    await expect(withTransitionalRepositoryLease({ repoRoot: root, runId: "run:release-retry" }, async () => (
      "recovered"
    ))).resolves.toBe("recovered");
  });

  it("preserves both the operation and release failures", async () => {
    const root = await temporaryDirectory();

    await expect(withTransitionalRepositoryLease({ repoRoot: root, runId: "run:double-failure" }, async () => {
      await createReleaseConflict(root);
      throw new Error("simulated operation failure");
    })).rejects.toSatisfy((error: unknown) => (
      error instanceof AggregateError
      && error.errors.some((cause) => cause instanceof Error && /operation failure/u.test(cause.message))
      && error.errors.some((cause) => (
        cause instanceof Error && !/operation failure/u.test(cause.message)
      ))
    ));
  });

  it("does not let a relinquish marker for an old token unlock the current owner", async () => {
    const root = await temporaryDirectory();
    const lock = path.join(root, ".manyhands", "run.lock");
    const token = "current-owner-token";
    await mkdir(lock, { recursive: true });
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      runId: "run:current-owner",
      pid: process.pid,
      token,
      generation: 2,
      acquiredAt: new Date().toISOString()
    }), "utf8");
    await writeFile(path.join(lock, `heartbeat-${token}.json`), JSON.stringify({
      token,
      at: new Date().toISOString()
    }), "utf8");
    await writeFile(path.join(lock, "released-old-owner-token.json"), JSON.stringify({
      token: "old-owner-token"
    }), "utf8");

    await expect(withTransitionalRepositoryLease({ repoRoot: root, runId: "run:contender" }, async () => (
      "must-not-enter"
    ))).rejects.toThrow(/Repository is owned by run run:current-owner/u);
  });

  it("does not silence a failure to publish the relinquish marker", async () => {
    const root = await temporaryDirectory();

    await expect(withTransitionalRepositoryLease({ repoRoot: root, runId: "run:marker-failure" }, async () => {
      const { lock, token } = await createReleaseConflict(root);
      const marker = path.join(lock, `released-${token}.json`);
      await mkdir(marker, { recursive: true });
      await writeFile(path.join(marker, "blocker"), "occupied\n", "utf8");
      return "must-not-publish";
    })).rejects.toSatisfy((error: unknown) => (
      error instanceof AggregateError && error.errors.length === 2
    ));
  });
});

async function createReleaseConflict(root: string): Promise<{ lock: string; token: string }> {
  const lock = path.join(root, ".manyhands", "run.lock");
  const owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")) as { token: string };
  const quarantine = `${lock}.released-${owner.token.slice(0, 8)}`;
  await mkdir(quarantine, { recursive: true });
  await writeFile(path.join(quarantine, "blocker"), "occupied\n", "utf8");
  return { lock, token: owner.token };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage8-lease-"));
  temporaryDirectories.push(directory);
  return directory;
}
