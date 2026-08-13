import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATCH as PATCH_WORKSPACE } from "@/app/api/workspaces/[id]/route";
import { POST as POST_WORKSPACES } from "@/app/api/workspaces/route";
import { captureRunTargetContext } from "@/lib/server/runs/target-context";
import { WorkspaceConflictError, WorkspaceValidationError } from "@/lib/server/workspaces/errors";
import { JsonWorkspaceRepository } from "@/lib/server/workspaces/repository";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";

let tempDir: string;
let previousWorkspacesFile: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-identity-"));
  previousWorkspacesFile = process.env.MANYHANDS_WORKSPACES_FILE;
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "route-workspaces.json");
  resetWorkspaceRepositoryForTests();
});

afterEach(async () => {
  if (previousWorkspacesFile === undefined) delete process.env.MANYHANDS_WORKSPACES_FILE;
  else process.env.MANYHANDS_WORKSPACES_FILE = previousWorkspacesFile;
  resetWorkspaceRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("workspace physical repository identity", () => {
  it("rejects an exact duplicate repository on create", async () => {
    const repoRoot = await makeGitRepo("exact");
    const workspaces = repository("exact-workspaces.json");
    await workspaces.create({ name: "First", repoPath: repoRoot });

    await expect(workspaces.create({ name: "Second", repoPath: repoRoot })).rejects.toBeInstanceOf(
      WorkspaceConflictError
    );
  });

  it("serializes independent repository instances without losing either successful create", async () => {
    const repoA = await makeGitRepo("concurrent-a");
    const repoB = await makeGitRepo("concurrent-b");
    const filePath = path.join(tempDir, "concurrent-workspaces.json");
    const left = new JsonWorkspaceRepository({ filePath, seeds: [], idFactory: () => "left-id" });
    const right = new JsonWorkspaceRepository({ filePath, seeds: [], idFactory: () => "right-id" });

    const created = await Promise.all([
      left.create({ name: "Left", repoPath: repoA }),
      right.create({ name: "Right", repoPath: repoB })
    ]);

    expect(created.map((workspace) => workspace.id).sort()).toEqual(["left-id", "right-id"]);
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      workspaces: Array<{ id: string }>;
    };
    expect(persisted.workspaces.map((workspace) => workspace.id).sort()).toEqual(["left-id", "right-id"]);
  });

  it.runIf(process.platform === "win32")("folds Windows path casing before comparison", async () => {
    const repoRoot = await makeGitRepo("mixed-Case-Repo");
    const workspaces = repository("case-workspaces.json");
    await workspaces.create({ name: "First", repoPath: repoRoot });

    await expect(workspaces.create({ name: "Second", repoPath: repoRoot.toUpperCase() })).rejects.toBeInstanceOf(
      WorkspaceConflictError
    );
  });

  it("recognizes a symlink or junction as the same physical repository", async () => {
    const repoRoot = await makeGitRepo("junction-source");
    const alias = path.join(tempDir, "junction-alias");
    await symlink(repoRoot, alias, process.platform === "win32" ? "junction" : "dir");
    const workspaces = repository("junction-workspaces.json");
    await workspaces.create({ name: "First", repoPath: repoRoot });

    await expect(workspaces.create({ name: "Second", repoPath: alias })).rejects.toBeInstanceOf(
      WorkspaceConflictError
    );
  });

  it("refreshes a persisted identity after a move plus junction and still rejects the duplicate", async () => {
    const originalPath = await makeGitRepo("identity-before-move");
    const movedPath = path.join(tempDir, "identity-after-move");
    const workspaces = repository("moved-workspaces.json");
    const first = await workspaces.create({ name: "First", repoPath: originalPath });

    await rename(originalPath, movedPath);
    await symlink(movedPath, originalPath, process.platform === "win32" ? "junction" : "dir");

    await expect(workspaces.create({ name: "Second", repoPath: movedPath })).rejects.toBeInstanceOf(
      WorkspaceConflictError
    );
    const refreshed = await workspaces.get(first.id);
    expect(refreshed.repoPath?.toLowerCase()).toBe((await realpath(movedPath)).toLowerCase());
    expect(await workspaces.list()).toHaveLength(1);
  });

  it("keeps the same filesystem identity after a pure move with no junction", async () => {
    const originalPath = await makeGitRepo("identity-before-pure-move");
    const movedPath = path.join(tempDir, "identity-after-pure-move");
    const workspaces = repository("pure-move-workspaces.json");
    const first = await workspaces.create({ name: "First", repoPath: originalPath });
    expect(first.repositoryIdentity?.filesystemObjectId).toEqual({
      version: 1,
      device: expect.stringMatching(/^\d+$/u),
      file: expect.stringMatching(/^\d+$/u)
    });

    await rename(originalPath, movedPath);

    await expect(workspaces.create({ name: "Second", repoPath: movedPath })).rejects.toBeInstanceOf(
      WorkspaceConflictError
    );
    expect(await workspaces.list()).toHaveLength(1);
  });

  it("recognizes a repository subdirectory as the same repository", async () => {
    const repoRoot = await makeGitRepo("subdir-source");
    const subdir = path.join(repoRoot, "src", "nested");
    await mkdir(subdir, { recursive: true });
    const workspaces = repository("subdir-workspaces.json");
    await workspaces.create({ name: "First", repoPath: repoRoot });

    await expect(workspaces.create({ name: "Second", repoPath: subdir })).rejects.toBeInstanceOf(
      WorkspaceConflictError
    );
  });

  it("recognizes linked Git worktrees through their shared common directory", async () => {
    const repoRoot = await makeGitRepo("worktree-source");
    const linkedWorktree = path.join(tempDir, "linked-worktree");
    execFileSync("git", ["worktree", "add", "--detach", linkedWorktree, "HEAD"], {
      cwd: repoRoot,
      stdio: "ignore"
    });
    const workspaces = repository("worktree-workspaces.json");
    await workspaces.create({ name: "First", repoPath: repoRoot });

    await expect(workspaces.create({ name: "Second", repoPath: linkedWorktree })).rejects.toBeInstanceOf(
      WorkspaceConflictError
    );
  });

  it("rejects an update that would collide and preserves the previous target", async () => {
    const repoA = await makeGitRepo("update-a");
    const repoB = await makeGitRepo("update-b");
    const workspaces = repository("update-workspaces.json");
    await workspaces.create({ name: "First", repoPath: repoA });
    const second = await workspaces.create({ name: "Second", repoPath: repoB });

    await expect(workspaces.update(second.id, { repoPath: path.join(repoA, "src") })).rejects.toBeInstanceOf(
      WorkspaceConflictError
    );
    expect((await workspaces.get(second.id)).repoPath?.toLowerCase()).toBe((await realpath(repoB)).toLowerCase());
  });

  it("fails closed when a new repoPath has no resolvable physical Git identity", async () => {
    const repoRoot = await makeGitRepo("identity-fail-closed");
    const unavailablePath = path.join(tempDir, "unavailable-repository");
    const workspaces = repository("identity-fail-closed-workspaces.json");
    const current = await workspaces.create({ name: "Current", repoPath: repoRoot });

    await expect(
      workspaces.create({ name: "Invalid", repoPath: unavailablePath })
    ).rejects.toThrow(/physical Git identity|accessible Git repository|permissions/i);
    await expect(
      workspaces.update(current.id, { name: "Should not persist", repoPath: unavailablePath })
    ).rejects.toBeInstanceOf(WorkspaceValidationError);

    const preserved = await workspaces.get(current.id);
    expect(preserved.name).toBe("Current");
    expect(preserved.repositoryIdentity?.filesystemObjectId).toBeDefined();
    expect(preserved.repoPath?.toLowerCase()).toBe((await realpath(repoRoot)).toLowerCase());
  });

  it("migrates duplicate legacy records to one canonical workspace and durable id aliases", async () => {
    const repoRoot = await makeGitRepo("legacy-source");
    const alias = path.join(tempDir, "legacy-alias");
    await symlink(repoRoot, alias, process.platform === "win32" ? "junction" : "dir");
    const filePath = path.join(tempDir, "legacy-workspaces.json");
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            ...legacyWorkspace("workspace-old", "Old", repoRoot, "2026-01-01T00:00:00.000Z"),
            allowedPaths: ["src/old"],
            testCommand: "pnpm test:old"
          },
          {
            ...legacyWorkspace("workspace-new", "New", alias, "2026-02-01T00:00:00.000Z"),
            allowedPaths: ["src/new"],
            testCommand: "pnpm test:new"
          }
        ]
      }),
      "utf8"
    );
    const workspaces = new JsonWorkspaceRepository({ filePath, seeds: [] });

    expect((await workspaces.list()).map((workspace) => workspace.id)).toEqual(["workspace-old"]);
    expect((await workspaces.get("workspace-new")).id).toBe("workspace-old");
    expect((await workspaces.equivalentIds("workspace-old")).sort()).toEqual(["workspace-new", "workspace-old"]);

    // One locked read must resolve every id `equivalentIds` would, canonical
    // and migrated alike; callers batch-resolving ids rely on it instead of
    // taking the workspace file lock once per workspace.
    const index = await workspaces.indexById();
    expect([...index.keys()].sort()).toEqual(["workspace-new", "workspace-old"]);
    expect(index.get("workspace-new")?.id).toBe("workspace-old");
    expect(index.get("workspace-old")?.id).toBe("workspace-old");

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      aliases?: Record<string, string>;
      workspaces: Array<{ id: string; repositoryIdentity?: { key: string } }>;
      migrationConflicts?: Array<{
        canonicalWorkspaceId: string;
        duplicateWorkspaceId: string;
        conflictingFields: string[];
        canonicalSnapshot: { allowedPaths?: string[]; testCommand?: string };
        duplicateSnapshot: { allowedPaths?: string[]; testCommand?: string };
      }>;
    };
    expect(persisted.workspaces).toHaveLength(1);
    expect(persisted.workspaces[0]?.repositoryIdentity?.key).toMatch(/^[a-f0-9]{64}$/u);
    expect(persisted.aliases).toEqual({ "workspace-new": "workspace-old" });
    expect(persisted.migrationConflicts).toEqual([
      expect.objectContaining({
        canonicalWorkspaceId: "workspace-old",
        duplicateWorkspaceId: "workspace-new",
        conflictingFields: expect.arrayContaining(["name", "allowedPaths", "testCommand"]),
        canonicalSnapshot: expect.objectContaining({
          allowedPaths: ["src/old"],
          testCommand: "pnpm test:old"
        }),
        duplicateSnapshot: expect.objectContaining({
          allowedPaths: ["src/new"],
          testCommand: "pnpm test:new"
        })
      })
    ]);

    const resolution = await workspaces.resolveMigrationConflict("workspace-new", "duplicate");
    expect(resolution.workspace).toMatchObject({
      id: "workspace-old",
      name: "New",
      allowedPaths: ["src/new"],
      testCommand: "pnpm test:new"
    });
    expect(resolution.migrationConflict.resolution).toMatchObject({ choice: "duplicate" });
    expect((await workspaces.snapshot()).migrationConflicts[0]?.resolution).toMatchObject({
      choice: "duplicate"
    });
  });
});

describe("workspace identity on productive routes", () => {
  it("returns 409 when POST uses a subdirectory alias of an existing workspace", async () => {
    const repoRoot = await makeGitRepo("route-post");
    const first = await postWorkspace("First", repoRoot);
    expect(first.status).toBe(201);

    const duplicate = await postWorkspace("Second", path.join(repoRoot, "src"));
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/already|workspace|repository/i);
  });

  it("returns 409 when PATCH points a workspace at another workspace's repository", async () => {
    const repoA = await makeGitRepo("route-patch-a");
    const repoB = await makeGitRepo("route-patch-b");
    await postWorkspace("First", repoA);
    const second = await postWorkspace("Second", repoB);
    const secondBody = (await second.json()) as { workspace: { id: string } };

    const response = await PATCH_WORKSPACE(
      new Request(`http://localhost/api/workspaces/${secondBody.workspace.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoPath: repoA })
      }),
      { params: Promise.resolve({ id: secondBody.workspace.id }) }
    );
    expect(response.status).toBe(409);
  });

});

describe("RunTargetContext canonical repository path", () => {
  it("captures the same top-level target and fingerprint through subdirectory and junction aliases", async () => {
    const repoRoot = await makeGitRepo("target-source");
    const alias = path.join(tempDir, "target-alias");
    await symlink(repoRoot, alias, process.platform === "win32" ? "junction" : "dir");

    const direct = await captureRunTargetContext(repoRoot);
    const throughSubdir = await captureRunTargetContext(path.join(repoRoot, "src"));
    const throughAlias = await captureRunTargetContext(alias);

    expect(throughSubdir?.sourceRealPath.toLowerCase()).toBe(direct?.sourceRealPath.toLowerCase());
    expect(throughAlias?.sourceRealPath.toLowerCase()).toBe(direct?.sourceRealPath.toLowerCase());
    expect(throughSubdir?.fingerprint).toBe(direct?.fingerprint);
    expect(throughAlias?.fingerprint).toBe(direct?.fingerprint);
  });
});

function repository(fileName: string): JsonWorkspaceRepository {
  return new JsonWorkspaceRepository({ filePath: path.join(tempDir, fileName), seeds: [] });
}

async function makeGitRepo(name: string): Promise<string> {
  const repoRoot = path.join(tempDir, name);
  await mkdir(path.join(repoRoot, "src"), { recursive: true });
  execFileSync("git", ["init", "-b", "main", repoRoot], { stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@manyhands.local"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "ManyHands Test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), `# ${name}\n`, "utf8");
  execFileSync("git", ["add", "."], { cwd: repoRoot });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot, stdio: "ignore" });
  return repoRoot;
}

async function postWorkspace(name: string, repoPath: string): Promise<Response> {
  return POST_WORKSPACES(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, repoPath })
    })
  );
}

function legacyWorkspace(id: string, name: string, repoPath: string, createdAt: string) {
  return {
    id,
    slug: name.toLowerCase(),
    name,
    repoPath,
    createdAt,
    updatedAt: createdAt
  };
}
