import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile, access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deliveryTargetGitPolicy,
  SimpleGitRunner,
  gitPolicyConfig,
  safeGitArgs
} from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
let directory: string;
let repo: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage7-git-policy-"));
  repo = path.join(directory, "repo");
  await git(directory, "init", "--initial-branch=main", repo);
  await git(repo, "config", "user.email", "test@manyhands.local");
  await git(repo, "config", "user.name", "ManyHands Test");
  await writeFile(path.join(repo, "base.txt"), "base\n", "utf8");
  await git(repo, "add", "base.txt");
  await git(repo, "commit", "-m", "base");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Stage 7 Git artifact policy", () => {
  it("passes an explicit deterministic policy to every native Git command", () => {
    const policy = gitPolicyConfig(repo);
    const args = safeGitArgs(repo, ["write-tree"]);

    expect(policy).toEqual(expect.arrayContaining([
      "core.hooksPath=/dev/null",
      "credential.helper=",
      "core.autocrlf=false",
      "core.attributesFile=/dev/null",
      "protocol.file.allow=never"
    ]));
    expect(args).toEqual(expect.arrayContaining(["-c", "core.hooksPath=/dev/null", "write-tree"]));
  });

  it("preserves the target repository's line-ending configuration during delivery", () => {
    const args = safeGitArgs(repo, ["status", "--porcelain"], "delivery_target");

    expect(deliveryTargetGitPolicy(repo)).toEqual(expect.arrayContaining([
      "core.hooksPath=/dev/null"
    ]));
    expect(args).not.toEqual(expect.arrayContaining(["core.autocrlf=false"]));
  });

  it("does not run a repository pre-commit hook while creating an orchestrator commit", async () => {
    const marker = path.join(repo, "hook-ran.txt");
    const hook = path.join(repo, ".git", "hooks", "pre-commit");
    await writeFile(hook, `#!/bin/sh\nprintf hook-ran > '${marker.replaceAll("\\", "/")}'\n`, "utf8");
    await chmod(hook, 0o755);
    await writeFile(path.join(repo, "candidate.txt"), "candidate\n", "utf8");

    const runner = new SimpleGitRunner();
    await runner.addAll(repo);
    await runner.commit({ cwd: repo, message: "orchestrator commit" });

    await expect(access(marker, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
