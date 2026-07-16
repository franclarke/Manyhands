import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/workspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/workspaces")>();
  return {
    ...actual,
    withWorkspaceReferenceLock: <T>(operation: () => Promise<T>): Promise<T> =>
      actual.withWorkspaceReferenceLock(operation, {
        retryMs: 1,
        releaseRename: async () => {
          throw Object.assign(new Error("simulated reference-lock release contention"), {
            code: "EBUSY"
          });
        }
      })
  };
});

import { POST as POST_FORK } from "@/app/api/runs/[id]/fork/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import {
  getWorkspaceRepository,
  resetWorkspaceRepositoryForTests,
  withWorkspaceReferenceLock
} from "@/lib/server/workspaces";
import {
  JsonFileCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata
} from "@manyhands/orchestrator-graph";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-fork-reference-release-"));
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
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

describe("fork commit truth across workspace reference-lock release", () => {
  it("returns 201 once and leaves the next reference-lock acquisition live", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Reference release" });
    const source = await getRunRepository().save({
      runId: "fork-reference-release-source",
      workspaceId: workspace.id,
      granularity: "balanced",
      model: "gpt-5.5",
      userPrompt: "Build it",
      title: "Fork reference release source",
      version: 0,
      status: "failed",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      executionStartedAt: "2026-07-16T00:05:00.000Z",
      patches: []
    });
    const saver = new JsonFileCheckpointSaver(
      path.join(process.env.MANYHANDS_RUNS_DIR!, "checkpoints")
    );
    await seedCheckpoint(saver, source.runId);

    const response = await POST_FORK(
      new Request(`http://manyhands.test/api/runs/${source.runId}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: source.runId }) }
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { newRunId: string };
    expect((await getRunRepository().list()).map((run) => run.runId).sort()).toEqual(
      [source.runId, payload.newRunId].sort()
    );
    expect((await getRunRepository().get(source.runId)).activeOperation).toBeUndefined();
    expect((await getRunRepository().get(payload.newRunId)).executionStartedAt).toBeUndefined();
    await expect(saver.inspectThread(payload.newRunId)).resolves.toMatchObject({ status: "ok" });
    expect(await checkpointThreads()).toEqual([payload.newRunId, source.runId].sort());

    await expect(withWorkspaceReferenceLock(async () => "next-owner")).resolves.toBe("next-owner");
  });
});

async function seedCheckpoint(saver: JsonFileCheckpointSaver, threadId: string): Promise<void> {
  const checkpoint = {
    v: 1,
    id: "fork-reference-release-checkpoint",
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {}
  } as unknown as Checkpoint;
  const metadata: CheckpointMetadata = { source: "input", step: 0, parents: {} };
  await saver.put({ configurable: { thread_id: threadId } }, checkpoint, metadata, {});
}

async function checkpointThreads(): Promise<string[]> {
  return readdir(path.join(process.env.MANYHANDS_RUNS_DIR!, "checkpoints"))
    .then((entries) => entries.sort())
    .catch(() => []);
}
