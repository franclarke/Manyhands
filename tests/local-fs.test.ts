import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { browseLocalDirectories } from "@/lib/server/local-fs";
import { inspectLocalGitRepo } from "@/lib/server/workspaces/repo-validation";

describe("local filesystem workspace helpers", () => {
  it("detects and summarizes a local git repository", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-local-fs-"));
    try {
      const repoRoot = path.join(tempDir, "repo");
      await initRepo(repoRoot);
      const info = await inspectLocalGitRepo(repoRoot);
      expect(info.repoRoot).toBe(path.resolve(repoRoot));
      expect(info.head).toMatch(/^[0-9a-f]{40}$/);
      expect(info.dirty).toBe(false);

      const listing = await browseLocalDirectories(tempDir);
      expect(listing.entries.find((entry) => entry.name === "repo")?.isGitRepo).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("detects git repositories without commits", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-local-fs-"));
    try {
      const repoRoot = path.join(tempDir, "repo");
      await mkdir(repoRoot, { recursive: true });
      git(repoRoot, "init", "-b", "main");

      const info = await inspectLocalGitRepo(repoRoot);
      expect(info.repoRoot).toBe(path.resolve(repoRoot));
      expect(info.branch).toBe("main");
      expect(info.head).toBeUndefined();
      expect(info.dirty).toBe(false);

      const listing = await browseLocalDirectories(repoRoot);
      expect(listing.git?.repoRoot).toBe(path.resolve(repoRoot));
      expect(listing.git?.head).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects paths outside a git repository", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-local-fs-"));
    try {
      await expect(inspectLocalGitRepo(tempDir)).rejects.toThrow("not inside a git repository");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function initRepo(repoRoot: string): Promise<void> {
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
