/**
 * B-008 — one immutable RunTargetContext (CF-19).
 *
 * The target repo is captured ONCE at run creation (realpath, git common
 * dir, branch, base commit, fingerprint, remote) and every later phase reads
 * that capture. Editing the workspace after create must not change what
 * planning grounds or execution provisions; a repoSpec override wins over
 * the workspace at capture time.
 */
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_RUNS } from "@/app/api/runs/route";
import { resolveRunRevealTarget } from "@/lib/server/runs/delivery-reveal-target";
import {
  captureRunTargetContext,
  resolveRunTargetPath,
  verifyProvisionedAgainstTarget
} from "@/lib/server/runs/target-context";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";

let tempDir: string;
let previousForceFallback: string | undefined;
let previousClaudeBin: string | undefined;
let previousCodexBin: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-target-"));
  previousForceFallback = process.env.MANYHANDS_FORCE_FALLBACK;
  previousClaudeBin = process.env.MANYHANDS_CLAUDE_BIN;
  previousCodexBin = process.env.MANYHANDS_CODEX_BIN;
  process.env.MANYHANDS_FORCE_FALLBACK = "1";
  const fakeTitler = await writeFakeTitlerBin(tempDir);
  process.env.MANYHANDS_CLAUDE_BIN = fakeTitler;
  process.env.MANYHANDS_CODEX_BIN = fakeTitler;
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
});

afterEach(async () => {
  await drainAllRunBackgroundTasksForTests();
  if (previousForceFallback === undefined) delete process.env.MANYHANDS_FORCE_FALLBACK;
  else process.env.MANYHANDS_FORCE_FALLBACK = previousForceFallback;
  if (previousClaudeBin === undefined) delete process.env.MANYHANDS_CLAUDE_BIN;
  else process.env.MANYHANDS_CLAUDE_BIN = previousClaudeBin;
  if (previousCodexBin === undefined) delete process.env.MANYHANDS_CODEX_BIN;
  else process.env.MANYHANDS_CODEX_BIN = previousCodexBin;
  delete process.env.MANYHANDS_WORKSPACES_FILE;
  delete process.env.MANYHANDS_RUNS_DIR;
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

async function writeFakeTitlerBin(dir: string): Promise<string> {
  const output = JSON.stringify({ title: "T", summary: "S" });
  const file = path.join(dir, process.platform === "win32" ? "fake-titler.cmd" : "fake-titler.sh");
  const content =
    process.platform === "win32" ? `@echo off\r\necho ${output}\r\n` : `#!/bin/sh\nprintf '%s\\n' '${output}'\n`;
  await writeFile(file, content, "utf8");
  await chmod(file, 0o755).catch(() => undefined);
  return file;
}

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

function headOf(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

async function createRun(body: Record<string, unknown>): Promise<string> {
  const response = await createRunResponse(body);
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { run?: { runId?: string } };
  return payload.run!.runId!;
}

async function createRunResponse(body: Record<string, unknown>): Promise<Response> {
  return POST_RUNS(
    new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        granularity: "balanced",
        model: "gpt-5.5",
        planningExecutorId: "claude-code-cli",
        planningModel: "sonnet",
        userPrompt: "Build a calculator",
        ...body
      })
    })
  );
}

describe("B-008 captureRunTargetContext", () => {
  it("captures realpath, git common dir, branch, base commit and fingerprint", async () => {
    const repoRoot = await makeGitRepo("repo-a");
    const context = await captureRunTargetContext(repoRoot);
    expect(context).toBeDefined();
    expect(context!.sourceRealPath.toLowerCase()).toBe((await realpath(repoRoot)).toLowerCase());
    expect(context!.gitCommonDir.toLowerCase()).toContain(".git");
    expect(context!.physicalIdentity).toEqual({
      version: 1,
      device: expect.stringMatching(/^\d+$/u),
      file: expect.stringMatching(/^\d+$/u)
    });
    expect(context!.sourceBranch).toBe("main");
    expect(context!.sourceBaseCommit).toBe(headOf(repoRoot));
    expect(context!.fingerprint.length).toBeGreaterThan(8);
  });

  it("returns undefined for a path that is not a git repo (legacy tolerance)", async () => {
    const context = await captureRunTargetContext(path.join(tempDir, "does-not-exist"));
    expect(context).toBeUndefined();
  });
});

describe("B-008 run creation freezes the target", () => {
  it("canonicalizes a migrated legacy workspace id when persisting a new run", async () => {
    const repoRoot = await makeGitRepo("repo-legacy-alias");
    const workspaceFile = process.env.MANYHANDS_WORKSPACES_FILE!;
    await writeFile(
      workspaceFile,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            id: "workspace-canonical",
            slug: "canonical",
            name: "Canonical",
            repoPath: repoRoot,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          {
            id: "workspace-legacy",
            slug: "legacy",
            name: "Legacy",
            repoPath: repoRoot,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z"
          }
        ]
      }),
      "utf8"
    );
    resetWorkspaceRepositoryForTests();
    await getWorkspaceRepository().list();

    const runId = await createRun({ workspaceId: "workspace-legacy" });
    expect((await getRunRepository().get(runId)).workspaceId).toBe("workspace-canonical");
  });

  it("captures the workspace repo at create; editing the workspace afterwards does not move the target", async () => {
    const repoA = await makeGitRepo("repo-a");
    const repoB = await makeGitRepo("repo-b");
    const workspace = await getWorkspaceRepository().create({ name: "ws", repoPath: repoA });

    const runId = await createRun({ workspaceId: workspace.id });
    const run = await getRunRepository().get(runId);
    expect(run.targetContext).toBeDefined();
    expect(run.targetContext!.sourceRealPath.toLowerCase()).toBe((await realpath(repoA)).toLowerCase());
    expect(run.targetContext!.sourceBaseCommit).toBe(headOf(repoA));

    // The user re-points the workspace somewhere else AFTER creating the run.
    await getWorkspaceRepository().update(workspace.id, { repoPath: repoB });

    const resolved = await resolveRunTargetPath(await getRunRepository().get(runId));
    expect(resolved?.toLowerCase()).toBe((await realpath(repoA)).toLowerCase());
    const revealTarget = await resolveRunRevealTarget(await getRunRepository().get(runId));
    expect(revealTarget?.toLowerCase()).toBe((await realpath(repoA)).toLowerCase());
  });

  it("a repoSpec override wins over the workspace at capture time", async () => {
    const repoA = await makeGitRepo("repo-a2");
    const repoB = await makeGitRepo("repo-b2");
    const workspace = await getWorkspaceRepository().create({ name: "ws2", repoPath: repoA });

    const runId = await createRun({
      workspaceId: workspace.id,
      repoSpec: { kind: "localPath", path: repoB }
    });
    const run = await getRunRepository().get(runId);
    expect(run.targetContext!.sourceRealPath.toLowerCase()).toBe((await realpath(repoB)).toLowerCase());
  });

  it("rejects a local target whose physical repository identity cannot be captured", async () => {
    const legacyRepoPath = path.join(tempDir, "no-such-repo");
    await writeFile(
      process.env.MANYHANDS_WORKSPACES_FILE!,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            id: "legacy-invalid-target",
            slug: "legacy-invalid-target",
            name: "Legacy invalid target",
            repoPath: legacyRepoPath,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }),
      "utf8"
    );
    resetWorkspaceRepositoryForTests();

    const response = await createRunResponse({ workspaceId: "legacy-invalid-target" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(
      /authoritative physical identity|accessible Git repository|run was not created/i
    );
    expect(await getRunRepository().list()).toHaveLength(0);
  });
});

describe("B-008 provisioning verifies against the captured target", () => {
  it("accepts a provision of the same repository and rejects a different one", async () => {
    const repoA = await makeGitRepo("repo-a3");
    const repoB = await makeGitRepo("repo-b3");
    const context = (await captureRunTargetContext(repoA))!;

    await expect(
      verifyProvisionedAgainstTarget({ sourceRepoRoot: repoA }, context)
    ).resolves.toBeUndefined();
    await expect(verifyProvisionedAgainstTarget({ sourceRepoRoot: repoB }, context)).rejects.toThrow(
      /target|distinto|different/i
    );
  });

  it("rejects a different repository recreated at the exact captured path", async () => {
    const repoPath = await makeGitRepo("replaceable-repo");
    const capturedPath = (await realpath(repoPath)).toLowerCase();
    const context = (await captureRunTargetContext(repoPath))!;
    const originalPhysicalIdentity = context.physicalIdentity;
    const movedOriginal = path.join(tempDir, "moved-original-repo");

    await rename(repoPath, movedOriginal);
    const replacementPath = await makeGitRepo("replaceable-repo");

    expect((await realpath(replacementPath)).toLowerCase()).toBe(capturedPath);
    expect((await captureRunTargetContext(replacementPath))?.physicalIdentity).not.toEqual(
      originalPhysicalIdentity
    );
    await expect(
      verifyProvisionedAgainstTarget({ sourceRepoRoot: replacementPath }, context)
    ).rejects.toThrow(/different physical repository|replaced|recreated|diverged/i);
  });

  it("fails closed for a legacy target context without physical identity evidence", async () => {
    const repoPath = await makeGitRepo("legacy-physical-identity");
    const captured = (await captureRunTargetContext(repoPath))!;
    const { physicalIdentity: _physicalIdentity, ...legacyContext } = captured;

    await expect(
      verifyProvisionedAgainstTarget({ sourceRepoRoot: repoPath }, legacyContext)
    ).rejects.toThrow(/predates physical repository identity|cannot prove|new run/i);
  });
});
