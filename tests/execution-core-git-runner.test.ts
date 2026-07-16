import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { SimpleGitRunner, safeGitArgs } from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("SimpleGitRunner ancestry", () => {
  it("returns false for sibling commits when git merge-base exits 1 without stderr", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-git-ancestor-"));
    tempDirectories.push(repoRoot);
    await git(repoRoot, "init", "--initial-branch=main");
    await git(repoRoot, "config", "user.email", "manyhands-tests@example.invalid");
    await git(repoRoot, "config", "user.name", "ManyHands Tests");

    await writeFile(path.join(repoRoot, "base.txt"), "base\n", "utf8");
    await git(repoRoot, "add", "base.txt");
    await git(repoRoot, "commit", "-m", "base");
    const base = await git(repoRoot, "rev-parse", "HEAD");

    await git(repoRoot, "switch", "--create", "left");
    await writeFile(path.join(repoRoot, "left.txt"), "left\n", "utf8");
    await git(repoRoot, "add", "left.txt");
    await git(repoRoot, "commit", "-m", "left");
    const left = await git(repoRoot, "rev-parse", "HEAD");

    await git(repoRoot, "switch", "--detach", base);
    await writeFile(path.join(repoRoot, "right.txt"), "right\n", "utf8");
    await git(repoRoot, "add", "right.txt");
    await git(repoRoot, "commit", "-m", "right");
    const right = await git(repoRoot, "rev-parse", "HEAD");

    const runner = new SimpleGitRunner();
    expect(await runner.isAncestor({ cwd: repoRoot, ancestor: base, descendant: right })).toBe(true);
    expect(await runner.isAncestor({ cwd: repoRoot, ancestor: left, descendant: right })).toBe(false);
    expect(await runner.isAncestor({ cwd: repoRoot, ancestor: right, descendant: left })).toBe(false);
  });

  it("classifies an already-satisfied cherry-pick separately from a conflict", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-git-empty-pick-"));
    tempDirectories.push(repoRoot);
    await git(repoRoot, "init", "--initial-branch=main");
    await git(repoRoot, "config", "user.email", "manyhands-tests@example.invalid");
    await git(repoRoot, "config", "user.name", "ManyHands Tests");

    await writeFile(path.join(repoRoot, "shared.txt"), "old\n", "utf8");
    await git(repoRoot, "add", "shared.txt");
    await git(repoRoot, "commit", "-m", "base");

    await git(repoRoot, "switch", "--create", "source");
    await writeFile(path.join(repoRoot, "shared.txt"), "same\n", "utf8");
    await git(repoRoot, "add", "shared.txt");
    await git(repoRoot, "commit", "-m", "source change");
    const source = await git(repoRoot, "rev-parse", "HEAD");

    await git(repoRoot, "switch", "main");
    await writeFile(path.join(repoRoot, "shared.txt"), "same\n", "utf8");
    await git(repoRoot, "add", "shared.txt");
    await git(repoRoot, "commit", "-m", "equivalent target change");
    const target = await git(repoRoot, "rev-parse", "HEAD");

    const runner = new SimpleGitRunner();
    const outcome = await runner.cherryPick({ cwd: repoRoot, commitSha: source });

    expect(outcome).toMatchObject({ ok: false, kind: "empty", conflictFiles: [] });
    expect(await runner.cherryPickHead(repoRoot)).toBe(source);
    await runner.cherryPickAbort(repoRoot);
    expect(await runner.head(repoRoot)).toBe(target);
    expect(await runner.statusPorcelain(repoRoot)).toEqual([]);
  });
});

describe("safeGitArgs", () => {
  it("normalizes the repository-scoped safe.directory value to Git path syntax", () => {
    const args = safeGitArgs("C:\\Users\\owner\\repo", ["status", "--porcelain"]);
    expect(args[0]).toBe("-c");
    expect(args[1]).toMatch(/^safe\.directory=/u);
    expect(args[1]).not.toContain("\\");
  });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
