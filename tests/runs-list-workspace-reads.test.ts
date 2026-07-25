import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as GET_RUNS } from "@/app/api/runs/route";
import { globalSingleton } from "@/lib/server/global-singleton";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces";
import type { Workspace, WorkspaceRepository } from "@/lib/server/workspaces";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

let tempDir: string;
let previousRunsDir: string | undefined;

/**
 * A workspace repository that records every read.
 *
 * Each real read takes the cross-process workspace file lock — a mkdir, an
 * exclusive owner write, two directory renames and a recursive remove — which
 * costs on the order of a second on a Windows volume. What matters is therefore
 * not how fast one read is but how MANY the route issues.
 */
function countingRepository(workspaceCount: number): { repository: WorkspaceRepository; reads: string[] } {
  const workspaces = Array.from({ length: workspaceCount }, (_, index) => ({
    id: `workspace-${index}`,
    name: `Workspace ${index}`,
    slug: `workspace-${index}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  })) as unknown as Workspace[];

  const reads: string[] = [];
  const record = <T>(name: string, value: T): Promise<T> => {
    reads.push(name);
    return Promise.resolve(value);
  };

  const repository = {
    list: () => record("list", workspaces),
    snapshot: () => record("snapshot", { workspaces, migrationConflicts: [] }),
    indexById: () => record("indexById", new Map(workspaces.map((workspace) => [workspace.id, workspace]))),
    equivalentIds: (id: string) => record("equivalentIds", [id]),
    get: () => Promise.reject(new Error("unexpected get")),
    getBySlug: () => Promise.reject(new Error("unexpected getBySlug")),
    create: () => Promise.reject(new Error("unexpected create")),
    update: () => Promise.reject(new Error("unexpected update")),
    delete: () => Promise.reject(new Error("unexpected delete")),
    resolveMigrationConflict: () => Promise.reject(new Error("unexpected resolveMigrationConflict"))
  } as unknown as WorkspaceRepository;

  return { repository, reads };
}

async function readsForListing(workspaceCount: number): Promise<string[]> {
  resetWorkspaceRepositoryForTests();
  const { repository, reads } = countingRepository(workspaceCount);
  globalSingleton("workspace-repository", () => repository);

  const response = await GET_RUNS(new Request("http://localhost/api/runs?limit=5"));
  expect(response.status).toBe(200);
  return reads;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-runs-reads-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
  for (let index = 0; index < 12; index += 1) {
    await getRunRepository().save(
      makeRunRecordV2({ runId: `run-${index}`, workspaceId: "missing-workspace", title: `run-${index}`, lifecycle: "completed" })
    );
  }
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  resetWorkspaceRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("GET /api/runs workspace reads", () => {
  it("does not read the workspace store once per workspace", async () => {
    const few = await readsForListing(2);
    const many = await readsForListing(60);

    // The listing resolves legacy workspace ids through an alias map. Building
    // that map by asking the store about each workspace in turn is an N+1 over
    // a cross-process file lock: with 12 workspaces the route spent ~17s of its
    // ~17.3s answering a query whose own data took 6ms to read.
    expect(many).toEqual(few);
  });

  it("answers an unfiltered listing with a single workspace read", async () => {
    expect(await readsForListing(12)).toHaveLength(1);
  });
});
