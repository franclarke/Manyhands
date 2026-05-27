import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunNotFoundError, RunValidationError } from "@/lib/server/runs/errors";
import {
  JsonRunRecordStore,
  type RunRepository
} from "@/lib/server/runs/repository";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let directory: string;
let repo: RunRepository;
let clockCounter = 0;

function makeRepository(): RunRepository {
  clockCounter = 0;
  return new JsonRunRecordStore({
    directory,
    clock: () => {
      clockCounter += 1;
      return `2026-05-26T00:00:${String(clockCounter).padStart(2, "0")}.000Z`;
    }
  });
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    scenarioId: "passwordless-login",
    granularity: "balanced",
    model: "claude-opus-4.7",
    userPrompt: "Add login",
    title: "Add login",
    status: "created",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-runs-"));
  directory = path.join(tempDir, "runs");
  repo = makeRepository();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("JsonRunRecordStore", () => {
  it("save then get round-trips", async () => {
    const saved = await repo.save(makeRun());
    const fetched = await repo.get(saved.runId);
    expect(fetched.runId).toBe(saved.runId);
  });

  it("get throws RunNotFoundError when file is missing", async () => {
    await expect(repo.get("missing")).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("list returns empty array when directory is missing", async () => {
    expect(await repo.list()).toEqual([]);
  });

  it("list sorts by updatedAt descending", async () => {
    await repo.save(makeRun({ runId: "a", createdAt: "2026-05-26T00:00:00.000Z" }));
    await repo.save(makeRun({ runId: "b", createdAt: "2026-05-26T01:00:00.000Z" }));
    await repo.save(makeRun({ runId: "c", createdAt: "2026-05-26T02:00:00.000Z" }));
    const all = await repo.list();
    expect(all.map((entry) => entry.runId)).toEqual(["c", "b", "a"]);
  });

  it("list filters by workspaceId and respects limit", async () => {
    await repo.save(makeRun({ runId: "a", workspaceId: "ws-1" }));
    await repo.save(makeRun({ runId: "b", workspaceId: "ws-2" }));
    await repo.save(makeRun({ runId: "c", workspaceId: "ws-1" }));
    const ws1 = await repo.list({ workspaceId: "ws-1" });
    expect(ws1.map((entry) => entry.runId).sort()).toEqual(["a", "c"]);
    expect((await repo.list({ limit: 1 })).length).toBe(1);
  });

  it("save updates updatedAt via injected clock", async () => {
    const first = await repo.save(makeRun());
    const second = await repo.save({ ...first, status: "generating" });
    expect(second.updatedAt > first.updatedAt).toBe(true);
  });

  it("delete removes a run", async () => {
    await repo.save(makeRun());
    await repo.delete("run-1");
    await expect(repo.get("run-1")).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("delete throws when run is missing", async () => {
    await expect(repo.delete("missing")).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("serialises parallel saves on the same runId", async () => {
    const base = makeRun();
    const results = await Promise.all(
      ["created", "generating", "needs_review"].map((status) =>
        repo.save({ ...base, status: status as RunRecord["status"] })
      )
    );
    expect(new Set(results.map((entry) => entry.runId)).size).toBe(1);
    const final = await repo.get("run-1");
    expect(["created", "generating", "needs_review"]).toContain(final.status);
  });

  it("rejects a corrupted file with RunValidationError", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "garbage.json"), "{ not json", "utf8");
    // list() should skip the unreadable file silently
    expect(await repo.list()).toEqual([]);
    // explicit get for the same runId surfaces the error
    await expect(
      repo.get("garbage")
    ).rejects.toBeInstanceOf(RunValidationError);
  });
});
