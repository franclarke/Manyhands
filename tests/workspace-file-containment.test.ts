/**
 * B-006 — realpath containment for the file API (CF-40).
 *
 * The lexical `..` check is not enough: a symlink/junction INSIDE the
 * workspace can point anywhere on disk and `stat/readFile` follow it. The
 * resolver must compare the REAL path of the target against the real
 * workspace root and refuse escapes, both at the helper and at the route.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as GET_FILE } from "@/app/api/runs/[id]/workspace-file/route";
import { resolveContainedWorkspaceFile } from "@/lib/server/runs/workspace-context";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let workspaceRoot: string;
let outsideDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-containment-"));
  workspaceRoot = path.join(tempDir, "workspace");
  outsideDir = path.join(tempDir, "outside");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(outsideDir, "secret.txt"), "MH_SECRET_CONTENT", "utf8");
  await writeFile(path.join(workspaceRoot, "inside.txt"), "inside", "utf8");
  // A junction (win32, no admin needed) / symlink pointing OUTSIDE the root.
  await symlink(outsideDir, path.join(workspaceRoot, "escape"), "junction");

  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-sonnet",
    userPrompt: "x",
    title: "x",
    version: 0,
    status: "completed",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    patches: [],
    provisioned: {
      repoRoot: workspaceRoot,
      baseBranch: "main",
      baseCommit: "abc",
      provisionedAt: "2026-07-12T00:00:00.000Z"
    }
  };
}

describe("B-006 resolveContainedWorkspaceFile", () => {
  it("resolves a real file inside the root", async () => {
    const resolved = await resolveContainedWorkspaceFile(workspaceRoot, "inside.txt");
    expect(resolved.toLowerCase()).toContain("inside.txt");
  });

  it("refuses a symlink/junction that escapes the root", async () => {
    await expect(resolveContainedWorkspaceFile(workspaceRoot, "escape/secret.txt")).rejects.toThrow(
      /escapes|fuera|outside/i
    );
  });
});

describe("B-006 workspace-file route", () => {
  it("serves an in-root file and refuses the junction escape with 403", async () => {
    const runId = "run-containment";
    await getRunRepository().save(makeRun(runId));

    const ok = await GET_FILE(
      new Request(`http://localhost/api/runs/${runId}/workspace-file?path=inside.txt`),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(ok.status).toBe(200);

    const escape = await GET_FILE(
      new Request(`http://localhost/api/runs/${runId}/workspace-file?path=escape/secret.txt`),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(escape.status).toBe(403);
    const body = (await escape.json()) as { content?: string };
    expect(body.content).toBeUndefined();
  });
});
