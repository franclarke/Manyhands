import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captureRunTargetContext,
  resolveProductRunTargetPath,
  resolveRunTargetPath,
  verifyProvisionedAgainstTarget
} from "@/lib/server/runs/target-context";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-target-"));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

async function makeGitRepo(name: string): Promise<string> {
  const repoRoot = path.join(tempDir, name);
  await mkdir(repoRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repoRoot]);
  execFileSync("git", ["config", "user.email", "t@mh.local"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "file.txt"), name, "utf8");
  execFileSync("git", ["add", "."], { cwd: repoRoot });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

describe("immutable V2 RunTargetContext", () => {
  it("captures real path, physical repository identity, branch, base and fingerprint", async () => {
    const repoRoot = await makeGitRepo("repo-a");
    const context = await captureRunTargetContext(repoRoot);

    expect(context?.sourceRealPath.toLowerCase()).toBe((await realpath(repoRoot)).toLowerCase());
    expect(context?.sourceBranch).toBe("main");
    expect(context?.sourceBaseCommit).toBe(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim());
    expect(context?.physicalIdentity).toEqual({
      version: 1,
      device: expect.stringMatching(/^\d+$/u),
      file: expect.stringMatching(/^\d+$/u)
    });
    expect(context?.fingerprint.length).toBeGreaterThan(8);
  });

  it("fails to capture a non-repository", async () => {
    await expect(captureRunTargetContext(path.join(tempDir, "missing"))).resolves.toBeUndefined();
  });

  it("resolves only the immutable captured target", async () => {
    const repoRoot = await makeGitRepo("repo-target");
    const targetContext = (await captureRunTargetContext(repoRoot))!;
    const run = makeRunRecordV2({ targetContext });

    await expect(resolveRunTargetPath(run)).resolves.toBe(targetContext.sourceRealPath);
    await expect(resolveProductRunTargetPath(targetContext)).resolves.toBe(targetContext.sourceRealPath);
  });

  it("rejects a different repository and one recreated at the captured path", async () => {
    const repoA = await makeGitRepo("replaceable");
    const repoB = await makeGitRepo("different");
    const context = (await captureRunTargetContext(repoA))!;

    await expect(verifyProvisionedAgainstTarget({ sourceRepoRoot: repoB }, context)).rejects.toThrow(/different repository|diverged target/i);

    await rename(repoA, path.join(tempDir, "moved-original"));
    const replacement = await makeGitRepo("replaceable");
    await expect(verifyProvisionedAgainstTarget({ sourceRepoRoot: replacement }, context)).rejects.toThrow(/different physical repository|replaced|recreated/i);
    await expect(resolveProductRunTargetPath(context)).resolves.toBeUndefined();
  });
});
