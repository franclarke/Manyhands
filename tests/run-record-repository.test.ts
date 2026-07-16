import { mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Count readFile calls so we can assert list() does not read the whole runs
// directory just to build a small "recent runs" slice (read amplification).
const ioSpy = vi.hoisted(() => ({ reads: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      ioSpy.reads += 1;
      return actual.readFile(...args);
    }
  };
});
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
    granularity: "balanced",
    model: "claude-opus-4.7",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "created",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    patches: [],
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

  it("list with a limit reads at most `limit` run files (no read amplification)", async () => {
    // Persist more runs than we will request, with strictly increasing mtimes so
    // the newest-N selection is deterministic across platforms.
    const baseMs = Date.parse("2026-05-26T00:00:00.000Z");
    for (let i = 0; i < 6; i += 1) {
      await repo.save(makeRun({ runId: `r${i}`, createdAt: "2026-05-26T00:00:00.000Z" }));
      const when = new Date(baseMs + i * 60_000);
      await utimes(path.join(directory, `r${i}.json`), when, when);
    }

    ioSpy.reads = 0;
    const recent = await repo.list({ limit: 2 });

    // The two newest runs come back, newest first…
    expect(recent.map((entry) => entry.runId)).toEqual(["r5", "r4"]);
    // …and we did not parse the other four files to produce that 2-item slice.
    expect(ioSpy.reads).toBeLessThanOrEqual(2);
  });

  it("list filters by workspaceId and respects limit", async () => {
    await repo.save(makeRun({ runId: "a", workspaceId: "ws-1" }));
    await repo.save(makeRun({ runId: "b", workspaceId: "ws-2" }));
    await repo.save(makeRun({ runId: "c", workspaceId: "ws-1" }));
    const ws1 = await repo.list({ workspaceId: "ws-1" });
    expect(ws1.map((entry) => entry.runId).sort()).toEqual(["a", "c"]);
    expect((await repo.list({ limit: 1 })).length).toBe(1);
  });

  it("filters by every canonical and legacy workspace id in one pass", async () => {
    await repo.save(makeRun({ runId: "canonical", workspaceId: "ws-canonical" }));
    await repo.save(makeRun({ runId: "legacy", workspaceId: "ws-legacy" }));
    await repo.save(makeRun({ runId: "other", workspaceId: "ws-other" }));

    const equivalent = await repo.list({ workspaceIds: ["ws-canonical", "ws-legacy"] });
    expect(equivalent.map((entry) => entry.runId).sort()).toEqual(["canonical", "legacy"]);
  });

  it("update merges against the latest record so concurrent writers cannot clobber a field", async () => {
    await repo.save(makeRun({ runId: "r" }));

    // Two updates touching DIFFERENT fields run concurrently. Each re-reads inside
    // the per-id lock, so both survive — modeling the heartbeat / planning-save race
    // where a stale `{ ...current }` would otherwise drop `planning`.
    await Promise.all([
      repo.update("r", (current) => ({
        ...current,
        planning: { decomposition: { graph: { rootId: "root", nodes: {}, dependencies: [] } } }
      })),
      repo.update("r", (current) => ({ ...current, heartbeatAt: "2026-05-26T00:09:00.000Z" }))
    ]);

    const got = await repo.get("r");
    expect((got.planning as { decomposition: { graph: { rootId: string } } }).decomposition.graph.rootId).toBe("root");
    expect(got.heartbeatAt).toBe("2026-05-26T00:09:00.000Z");
  });

  it("serializes mutations across independent repository instances", async () => {
    await repo.save(makeRun({ runId: "cross-instance" }));
    const other = new JsonRunRecordStore({ directory });

    await Promise.all(
      Array.from({ length: 100 }, (_, index) => {
        const writer = index % 2 === 0 ? repo : other;
        return writer.update("cross-instance", (current) => ({
          ...current,
          questionAnswers: {
            ...(current.questionAnswers ?? {}),
            [`writer-${index}`]: String(index)
          }
        }));
      })
    );

    const final = await repo.get("cross-instance");
    expect(Object.keys(final.questionAnswers ?? {})).toHaveLength(100);
    expect(final.version).toBe(101);
  });

  it("update throws RunNotFoundError when the run is missing", async () => {
    await expect(repo.update("missing", (current) => current)).rejects.toBeInstanceOf(RunNotFoundError);
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
