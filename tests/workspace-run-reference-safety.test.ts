import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const daemon = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/server/daemon/productive-client", () => ({ listProductRuns: daemon.list }));

import { DELETE as DELETE_WORKSPACE } from "@/app/api/workspaces/[id]/route";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";

let tempDir: string;
let previousWorkspacesFile: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-run-references-"));
  previousWorkspacesFile = process.env.MANYHANDS_WORKSPACES_FILE;
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  resetWorkspaceRepositoryForTests();
  daemon.list.mockReset();
  await writeFile(
    process.env.MANYHANDS_WORKSPACES_FILE,
    JSON.stringify({ version: 1, workspaces: [workspace("workspace-target"), workspace("workspace-other")] }),
    "utf8"
  );
});

afterEach(async () => {
  if (previousWorkspacesFile === undefined) delete process.env.MANYHANDS_WORKSPACES_FILE;
  else process.env.MANYHANDS_WORKSPACES_FILE = previousWorkspacesFile;
  resetWorkspaceRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("workspace deletion run-reference safety", () => {
  it("allows deletion when the daemon has no run for the workspace", async () => {
    daemon.list.mockResolvedValue([]);

    const response = await removeTarget();

    expect(response.status).toBe(204);
    const persisted = JSON.parse(await readFile(process.env.MANYHANDS_WORKSPACES_FILE!, "utf8")) as {
      workspaces: Array<{ id: string }>;
    };
    expect(persisted.workspaces.map((entry) => entry.id)).toEqual(["workspace-other"]);
    expect(daemon.list).toHaveBeenCalledWith({
      workspaceId: "workspace-target",
      includeArchived: true,
      limit: 1
    });
  });

  it("blocks deletion when the daemon projection references the workspace", async () => {
    daemon.list.mockResolvedValue([{ runId: "run-daemon" }]);

    const response = await removeTarget();

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("run-daemon");
  });
});

function removeTarget(): Promise<Response> {
  return DELETE_WORKSPACE(
    new Request("http://localhost/api/workspaces/workspace-target", { method: "DELETE" }),
    { params: Promise.resolve({ id: "workspace-target" }) }
  );
}

function workspace(id: string) {
  return {
    id,
    slug: id,
    name: id,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}
