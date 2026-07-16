import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  JsonWorkspaceRepository,
  type WorkspaceRepository
} from "@/lib/server/workspaces/repository";
import { WorkspaceCreateInputSchema, WorkspaceUpdateInputSchema } from "@/lib/server/workspaces/schema";

let tempDir: string;
let repo: WorkspaceRepository;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-ws-settings-"));
  repo = new JsonWorkspaceRepository({
    filePath: path.join(tempDir, "workspaces.json"),
    seeds: []
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("workspace settings schema", () => {
  it("accepts an empty create input with just a name", () => {
    expect(
      WorkspaceCreateInputSchema.safeParse({ name: "Demo" }).success
    ).toBe(true);
  });

  it("accepts every optional hint", () => {
    const result = WorkspaceCreateInputSchema.safeParse({
      name: "Demo",
      repoPath: "/Users/me/code/demo",
      packageManager: "pnpm",
      defaultBranch: "main",
      allowedPaths: ["src/**", "packages/**"],
      testCommand: "pnpm test",
      buildCommand: "pnpm build"
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid package manager", () => {
    const result = WorkspaceCreateInputSchema.safeParse({
      name: "Demo",
      packageManager: "cargo"
    });
    expect(result.success).toBe(false);
  });

  it("rejects allowedPaths with more than 40 entries", () => {
    const result = WorkspaceCreateInputSchema.safeParse({
      name: "Demo",
      allowedPaths: Array.from({ length: 41 }, (_value, index) => `path-${index}`)
    });
    expect(result.success).toBe(false);
  });

  it("update input accepts a partial hint payload", () => {
    expect(
      WorkspaceUpdateInputSchema.safeParse({ testCommand: "pnpm test --once" }).success
    ).toBe(true);
  });
});

describe("repository persistence of hints", () => {
  it("persists hints on create and surfaces them on read", async () => {
    const repoPath = await makeGitRepo("demo");
    const created = await repo.create({
      name: "Demo",
      repoPath,
      packageManager: "pnpm",
      defaultBranch: "main",
      allowedPaths: ["src/**"],
      testCommand: "pnpm test",
      buildCommand: "pnpm build"
    });
    expect(created.repoPath).toBe(repoPath);
    expect(created.packageManager).toBe("pnpm");
    expect(created.allowedPaths).toEqual(["src/**"]);
    const fetched = await repo.get(created.id);
    expect(fetched.testCommand).toBe("pnpm test");
  });

  it("preserves hints on update when not overridden", async () => {
    const repoPath = await makeGitRepo("preserved");
    const created = await repo.create({
      name: "Demo",
      repoPath,
      testCommand: "pnpm test"
    });
    const updated = await repo.update(created.id, { name: "Demo Renamed" });
    expect(updated.name).toBe("Demo Renamed");
    expect(updated.repoPath).toBe(repoPath);
    expect(updated.testCommand).toBe("pnpm test");
  });
});

async function makeGitRepo(name: string): Promise<string> {
  const repoRoot = path.join(tempDir, name);
  await mkdir(repoRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repoRoot], { stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@manyhands.local"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "ManyHands Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), `# ${name}\n`, "utf8");
  execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot, stdio: "ignore" });
  return repoRoot;
}
