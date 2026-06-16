import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureRunnableRepo } from "@/lib/server/workspaces/ensure-runnable-repo";

describe("ensureRunnableRepo", () => {
  it("initializes an empty folder on main with an initial commit", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-ensure-repo-"));
    try {
      const repoRoot = path.join(tempDir, "empty");
      await mkdir(repoRoot);

      const info = await ensureRunnableRepo(repoRoot);

      expect(info.repoRoot).toBe(path.resolve(repoRoot));
      expect(info.branch).toBe("main");
      expect(info.head).toMatch(/^[0-9a-f]{40}$/);
      await expect(stat(path.join(repoRoot, "README.md"))).resolves.toBeTruthy();
      await expect(stat(path.join(repoRoot, ".gitignore"))).resolves.toBeTruthy();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates the initial commit for a git repo with unborn HEAD", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-ensure-repo-"));
    try {
      const repoRoot = path.join(tempDir, "unborn");
      await mkdir(repoRoot);
      git(repoRoot, "init", "-b", "main");
      await writeFile(path.join(repoRoot, "src.txt"), "existing\n");

      const info = await ensureRunnableRepo(repoRoot);

      expect(info.branch).toBe("main");
      expect(info.head).toMatch(/^[0-9a-f]{40}$/);
      expect(git(repoRoot, "status", "--porcelain")).toBe("");
      expect(git(repoRoot, "ls-tree", "--name-only", "HEAD")).toContain("src.txt");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not touch a repo that already has commits", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-ensure-repo-"));
    try {
      const repoRoot = path.join(tempDir, "committed");
      await initCommittedRepo(repoRoot);
      const headBefore = git(repoRoot, "rev-parse", "HEAD");

      const info = await ensureRunnableRepo(repoRoot);

      expect(info.head).toBe(headBefore);
      expect(git(repoRoot, "rev-parse", "HEAD")).toBe(headBefore);
      await expect(stat(path.join(repoRoot, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing README.md or .gitignore when committing an unborn repo", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-ensure-repo-"));
    try {
      const repoRoot = path.join(tempDir, "existing-files");
      await mkdir(repoRoot);
      git(repoRoot, "init", "-b", "main");
      await writeFile(path.join(repoRoot, "README.md"), "# Custom\n");
      await writeFile(path.join(repoRoot, ".gitignore"), "custom-ignore\n");

      await ensureRunnableRepo(repoRoot);

      await expect(readFile(path.join(repoRoot, "README.md"), "utf8")).resolves.toBe("# Custom\n");
      await expect(readFile(path.join(repoRoot, ".gitignore"), "utf8")).resolves.toBe("custom-ignore\n");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function initCommittedRepo(repoRoot: string): Promise<void> {
  await mkdir(repoRoot, { recursive: true });
  await writeFile(path.join(repoRoot, "README.md"), "hello\n");
  git(repoRoot, "init", "-b", "main");
  git(repoRoot, "config", "user.name", "Test");
  git(repoRoot, "config", "user.email", "test@example.com");
  git(repoRoot, "config", "commit.gpgsign", "false");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-m", "base");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
