import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const releaseSeam = vi.hoisted(() => ({ failuresRemaining: 0 }));

vi.mock("@/lib/server/runs/run-operation-lease", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/runs/run-operation-lease")>();
  return {
    ...actual,
    releaseRunOperation: async (...args: Parameters<typeof actual.releaseRunOperation>) => {
      if (releaseSeam.failuresRemaining > 0) {
        releaseSeam.failuresRemaining -= 1;
        throw new Error("simulated source lease release I/O failure");
      }
      return actual.releaseRunOperation(...args);
    }
  };
});

import { POST as POST_FORK } from "@/app/api/runs/[id]/fork/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import {
  getWorkspaceRepository,
  resetWorkspaceRepositoryForTests
} from "@/lib/server/workspaces";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-fork-release-"));
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  releaseSeam.failuresRemaining = 0;
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_WORKSPACES_FILE;
  delete process.env.MANYHANDS_RUNS_DIR;
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("fork durable lease release", () => {
  it("rolls back the child and retries source release before reporting an I/O failure", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Fork release" });
    const source = await getRunRepository().save({
      runId: "fork-release-source",
      workspaceId: workspace.id,
      granularity: "balanced",
      model: "gpt-5.5",
      userPrompt: "Build it",
      title: "Fork release source",
      version: 0,
      status: "failed",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      patches: []
    });
    const checkpointThreadsBefore = await checkpointThreads();
    releaseSeam.failuresRemaining = 1;

    const response = await POST_FORK(
      new Request(`http://manyhands.test/api/runs/${source.runId}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: source.runId }) }
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/could not release.*source lease|rolled back|retried/i);
    expect((await getRunRepository().list()).map((run) => run.runId)).toEqual([source.runId]);
    expect((await getRunRepository().get(source.runId)).activeOperation).toBeUndefined();
    expect(await checkpointThreads()).toEqual(checkpointThreadsBefore);
  });
});

async function checkpointThreads(): Promise<string[]> {
  return readdir(path.join(process.env.MANYHANDS_RUNS_DIR!, "checkpoints"))
    .then((entries) => entries.sort())
    .catch(() => []);
}
