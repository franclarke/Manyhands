import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as DELETE_WORKSPACE } from "@/app/api/workspaces/[id]/route";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";

let tempDir: string;
let previousRunsDir: string | undefined;
let previousWorkspacesFile: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-run-references-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  previousWorkspacesFile = process.env.MANYHANDS_WORKSPACES_FILE;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  resetRunRepositoryForTests();
  resetWorkspaceRepositoryForTests();
  await writeFile(
    process.env.MANYHANDS_WORKSPACES_FILE,
    JSON.stringify({ version: 1, workspaces: [workspace("workspace-target"), workspace("workspace-other")] }),
    "utf8"
  );
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  if (previousWorkspacesFile === undefined) delete process.env.MANYHANDS_WORKSPACES_FILE;
  else process.env.MANYHANDS_WORKSPACES_FILE = previousWorkspacesFile;
  resetRunRepositoryForTests();
  resetWorkspaceRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("workspace deletion run-reference safety", () => {
  it("allows deletion when a legacy run explicitly belongs to another workspace", async () => {
    await writeLegacyRun("legacy-other", "workspace-other");

    const response = await DELETE_WORKSPACE(
      new Request("http://localhost/api/workspaces/workspace-target", { method: "DELETE" }),
      { params: Promise.resolve({ id: "workspace-target" }) }
    );

    expect(response.status).toBe(204);
    const persisted = JSON.parse(await readFile(process.env.MANYHANDS_WORKSPACES_FILE!, "utf8")) as {
      workspaces: Array<{ id: string }>;
    };
    expect(persisted.workspaces.map((entry) => entry.id)).toEqual(["workspace-other"]);
  });

  it("still blocks deletion when a legacy run explicitly belongs to the workspace", async () => {
    await writeLegacyRun("legacy-target", "workspace-target");

    const response = await DELETE_WORKSPACE(
      new Request("http://localhost/api/workspaces/workspace-target", { method: "DELETE" }),
      { params: Promise.resolve({ id: "workspace-target" }) }
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("legacy-target.json");
  });
});

function workspace(id: string) {
  return {
    id,
    slug: id,
    name: id,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

async function writeLegacyRun(runId: string, workspaceId: string): Promise<void> {
  const directory = process.env.MANYHANDS_RUNS_DIR!;
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${runId}.json`),
    JSON.stringify({ version: 1, run: { runId, workspaceId } }),
    "utf8"
  );
}
