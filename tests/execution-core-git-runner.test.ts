import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { SimpleGitRunner, safeGitArgs } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner.js";

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

describe("SimpleGitRunner commit identity", () => {
  it("uses a command-scoped ManyHands identity when the repository has no usable author", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-git-identity-"));
    tempDirectories.push(repoRoot);
    await git(repoRoot, "init", "--initial-branch=main");

    await writeFile(path.join(repoRoot, "base.txt"), "base\n", "utf8");
    await git(repoRoot, "add", "base.txt");
    await git(
      repoRoot,
      "-c",
      "user.name=Bootstrap",
      "-c",
      "user.email=bootstrap@example.invalid",
      "commit",
      "-m",
      "base"
    );
    await git(repoRoot, "config", "--local", "user.name", "");
    await git(repoRoot, "config", "--local", "user.email", "");

    await writeFile(path.join(repoRoot, "change.txt"), "change\n", "utf8");
    await git(repoRoot, "add", "change.txt");

    const commit = await new SimpleGitRunner().commit({ cwd: repoRoot, message: "candidate" });

    expect(await git(repoRoot, "show", "-s", "--format=%an <%ae>", commit))
      .toBe("ManyHands <manyhands@local>");
    expect(await git(repoRoot, "config", "--local", "--get", "user.name")).toBe("");
    expect(await git(repoRoot, "config", "--local", "--get", "user.email")).toBe("");
  });
});

describe("GitRunner bounded file reads", () => {
  it("rejects a git blob that exceeds the byte budget", async () => {
    const repoRoot = await createRepositoryWithFile("large.txt", "0123456789");

    await expect(new SimpleGitRunner().showFile(
      { cwd: repoRoot, ref: "HEAD", path: "large.txt" },
      { maxBytes: 5 }
    )).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
  });

  it("propagates cancellation instead of treating it as a missing file", async () => {
    const repoRoot = await createRepositoryWithFile("present.txt", "present\n");
    const controller = new AbortController();
    controller.abort();

    await expect(new SimpleGitRunner().showFile(
      { cwd: repoRoot, ref: "HEAD", path: "present.txt" },
      { signal: controller.signal }
    )).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
  });

  it("returns null only for a missing Git object or path", async () => {
    const repoRoot = await createRepositoryWithFile("present.txt", "present\n");
    const runner = new SimpleGitRunner();

    await expect(runner.showFile({ cwd: repoRoot, ref: "HEAD", path: "missing.txt" }))
      .resolves.toBeNull();
    await expect(runner.showFile({ cwd: repoRoot, ref: "missing-ref", path: "present.txt" }))
      .resolves.toBeNull();
    await expect(runner.showFile({ cwd: path.join(repoRoot, "missing-directory"), ref: "HEAD", path: "present.txt" }))
      .rejects.toBeDefined();
  });

  it("keeps the fake aligned with cancellation and byte-budget semantics", async () => {
    const runner = new FakeGitRunner({ showFile: { "present.txt": "áéí" } });
    const controller = new AbortController();
    controller.abort();

    await expect(runner.showFile(
      { cwd: "C:/repo", ref: "HEAD", path: "present.txt" },
      { signal: controller.signal }
    )).rejects.toMatchObject({ name: "AbortError" });
    await expect(runner.showFile(
      { cwd: "C:/repo", ref: "HEAD", path: "present.txt" },
      { maxBytes: 5 }
    )).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
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

async function createRepositoryWithFile(file: string, contents: string): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-git-show-"));
  tempDirectories.push(repoRoot);
  await git(repoRoot, "init", "--initial-branch=main");
  await git(repoRoot, "config", "user.email", "manyhands-tests@example.invalid");
  await git(repoRoot, "config", "user.name", "ManyHands Tests");
  await writeFile(path.join(repoRoot, file), contents, "utf8");
  await git(repoRoot, "add", file);
  await git(repoRoot, "commit", "-m", "fixture");
  return repoRoot;
}
