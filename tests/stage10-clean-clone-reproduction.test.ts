import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createCurrentDeliveryPort } from "../apps/daemon/src/current-lifecycle-adapters.js";

import {
  buildDeliveryTargetFixture,
  git,
  removeDeliveryTargetFixture,
  stage10Approval,
  stage10Definition,
  stage10Projection,
  type Stage10DeliveryTarget
} from "./helpers/stage10-delivery-fixture.js";

const execFileAsync = promisify(execFile);

const targets: Stage10DeliveryTarget[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all([
    ...targets.splice(0).map(removeDeliveryTargetFixture),
    // Windows keeps handles on a freshly cloned `.git` for a moment after the
    // clone process exits, so removal needs to be patient rather than lucky.
    ...directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    )
  ]);
});

/**
 * The receipt claims the target holds a specific tree. That claim is only worth
 * something if someone other than the machine that made it can check it, so the
 * check is a fresh clone: no worktree pool, no `.manyhands/`, no index the
 * delivery left behind.
 *
 * Running the recorded command in that clone is the second half. A tree that
 * matches but does not pass its own validation would mean the receipt described
 * the bytes correctly and the claim about them was still false.
 */
describe("A clean clone reproduces the delivered claim", () => {
  it("clones to the exact tree the receipt names, and the tree passes its own validation", async () => {
    const fixture = await target();

    const receipt = await createCurrentDeliveryPort().publish({
      runId: "run:stage10-clone",
      definition: stage10Definition(fixture),
      approval: stage10Approval(fixture),
      projection: stage10Projection(fixture),
      events: []
    });

    const clone = await temporaryDirectory();
    await execFileAsync("git", ["clone", "--branch", "main", fixture.root, clone], { windowsHide: true });

    expect(await git(clone, "rev-parse", "HEAD")).toBe(receipt.finalSha);
    expect(await git(clone, "rev-parse", "HEAD^{tree}")).toBe(receipt.deliveredTreeSha);

    const validation = await execFileAsync(process.execPath, ["--test"], {
      cwd: clone,
      windowsHide: true,
      encoding: "utf8"
    });
    expect(validation.stdout).toContain("pass 1");
    expect(validation.stdout).toContain("fail 0");
  });

  it("reproduces the tree without any ManyHands state in the clone", async () => {
    // Delivery runs inside the target, so the orchestrator's own directory is
    // present when the receipt is written. The claim must not depend on it.
    const fixture = await target();
    await createCurrentDeliveryPort().publish({
      runId: "run:stage10-clone-clean",
      definition: stage10Definition(fixture),
      approval: stage10Approval(fixture),
      projection: stage10Projection(fixture),
      events: []
    });

    const clone = await temporaryDirectory();
    await execFileAsync("git", ["clone", "--branch", "main", fixture.root, clone], { windowsHide: true });

    const tracked = await git(clone, "ls-tree", "-r", "--name-only", "HEAD");
    expect(tracked.split("\n").filter((entry) => entry.startsWith(".manyhands"))).toEqual([]);
    expect(tracked.split("\n").sort()).toEqual(["package.json", "result.test.js", "result.txt"]);
  });
});

async function target(): Promise<Stage10DeliveryTarget> {
  const fixture = await buildDeliveryTargetFixture();
  targets.push(fixture);
  return fixture;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage10-clone-"));
  directories.push(directory);
  return directory;
}
