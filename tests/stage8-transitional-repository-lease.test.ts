import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage8-lease-"));
  temporaryDirectories.push(directory);
  return directory;
}
