import { mkdtemp, rm, utimes } from "node:fs/promises";
import type { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ioSpy = vi.hoisted(() => ({ reads: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { readFile: typeof readFile }>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      ioSpy.reads += 1;
      return actual.readFile(...args);
    }
  };
});

import { RunNotFoundError, RunValidationError } from "@/lib/server/runs/errors";
import { JsonRunRecordStore, type RunRepository } from "@/lib/server/runs/repository";
import type { RunRecord } from "@/lib/server/runs/schema";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

let tempDir: string;
let directory: string;
let repo: RunRepository;
let clockCounter = 0;

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return makeRunRecordV2({ runId: "run-1", workspaceId: "ws-1", ...overrides });
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-runs-v2-"));
  directory = path.join(tempDir, "runs");
  clockCounter = 0;
  repo = new JsonRunRecordStore({
    directory,
    clock: () => `2026-07-17T12:00:${String(++clockCounter).padStart(2, "0")}.000Z`
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("JsonRunRecordStore V2 cache", () => {
  it("round-trips a canonical record and rejects a missing id", async () => {
    const saved = await repo.save(makeRun());
    expect(await repo.get(saved.runId)).toEqual(saved);
    await expect(repo.get("missing")).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("lists newest first and filters equivalent workspace ids", async () => {
    await repo.save(makeRun({ runId: "a", workspaceId: "ws-a" }));
    await repo.save(makeRun({ runId: "b", workspaceId: "ws-b" }));
    await repo.save(makeRun({ runId: "c", workspaceId: "ws-a" }));
    expect((await repo.list()).map((run) => run.runId)).toEqual(["c", "b", "a"]);
    expect((await repo.list({ workspaceIds: ["ws-a"] })).map((run) => run.runId)).toEqual(["c", "a"]);
  });

  it("limits disk reads for a recent-runs slice", async () => {
    const baseMs = Date.parse("2026-07-17T12:00:00.000Z");
    for (let index = 0; index < 6; index += 1) {
      await repo.save(makeRun({ runId: `r${index}` }));
      const when = new Date(baseMs + index * 60_000);
      await utimes(path.join(directory, `r${index}.json`), when, when);
    }
    ioSpy.reads = 0;
    expect((await repo.list({ limit: 2 })).map((run) => run.runId)).toEqual(["r5", "r4"]);
    expect(ioSpy.reads).toBeLessThanOrEqual(2);
  });

  it("serializes concurrent updates across store instances", async () => {
    await repo.save(makeRun({ runId: "shared" }));
    const other = new JsonRunRecordStore({ directory });
    await Promise.all(Array.from({ length: 50 }, (_, index) => {
      const writer = index % 2 === 0 ? repo : other;
      return writer.update("shared", (current) => ({
        ...current,
        projection: { ...current.projection, eventSequence: current.projection.eventSequence + 1 }
      }));
    }));
    const final = await repo.get("shared");
    expect(final.projection.eventSequence).toBe(50);
    expect(final.version).toBe(51);
  });

  it("preserves both fields when concurrent writers update different cache metadata", async () => {
    await repo.save(makeRun({ runId: "merge" }));
    await Promise.all([
      repo.update("merge", (current) => ({ ...current, title: "updated title" })),
      repo.update("merge", (current) => ({ ...current, heartbeatAt: "2026-07-17T12:09:00.000Z" }))
    ]);
    expect(await repo.get("merge")).toMatchObject({
      title: "updated title",
      heartbeatAt: "2026-07-17T12:09:00.000Z"
    });
  });

  it("deletes records and surfaces corrupt explicit reads", async () => {
    await repo.save(makeRun());
    await repo.delete("run-1");
    await expect(repo.get("run-1")).rejects.toBeInstanceOf(RunNotFoundError);

    const fs = await import("node:fs/promises");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "garbage.json"), "{ not json", "utf8");
    expect(await repo.list()).toEqual([]);
    await expect(repo.get("garbage")).rejects.toBeInstanceOf(RunValidationError);
  });
});
