import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ioSpy = vi.hoisted(() => ({ reads: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      ioSpy.reads.push(String(args[0]));
      return actual.readFile(...args);
    }
  };
});

import {
  JsonRunRecordStore,
  listCorruptRunRecords
} from "@/lib/server/runs/repository";
import type { RunRecord } from "@/lib/server/runs/schema";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

let tempDir: string;
let runsDir: string;

function makeRun(runId: string): RunRecord {
  return makeRunRecordV2({ runId, workspaceId: "ws", title: runId, lifecycle: "completed" });
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-index-"));
  runsDir = path.join(tempDir, "runs");
  const store = new JsonRunRecordStore({ directory: runsDir });
  for (let index = 0; index < 9; index += 1) {
    await store.save(makeRun(`run-${index}`));
  }
  ioSpy.reads = [];
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("bounded run-record diagnostics index", () => {
  it("does not parse run records on the cached hot path", async () => {
    expect(await listCorruptRunRecords({ directory: runsDir, inspectionBudget: 0 })).toEqual([]);
    expect(ioSpy.reads.filter((entry) => /run-\d+\.json$/.test(entry))).toHaveLength(0);
  });

  it("inspects only the configured batch, then reuses durable metadata", async () => {
    await listCorruptRunRecords({ directory: runsDir, inspectionBudget: 3 });
    expect(ioSpy.reads.filter((entry) => /run-\d+\.json$/.test(entry))).toHaveLength(3);

    ioSpy.reads = [];
    await listCorruptRunRecords({ directory: runsDir, inspectionBudget: 3 });
    expect(ioSpy.reads.filter((entry) => /run-\d+\.json$/.test(entry))).toHaveLength(3);

    await listCorruptRunRecords({ directory: runsDir, inspectionBudget: 3 });
    ioSpy.reads = [];
    await listCorruptRunRecords({ directory: runsDir, inspectionBudget: 3 });
    expect(ioSpy.reads.filter((entry) => /run-\d+\.json$/.test(entry))).toHaveLength(0);
    expect(await stat(path.join(runsDir, ".diagnostics", "run-record-index.json"))).toBeDefined();
  });

  it("eventually surfaces corruption without an unbounded directory parse", async () => {
    await mkdir(runsDir, { recursive: true });
    await writeFile(path.join(runsDir, "torn.json"), "{ torn", "utf8");

    let corrupt: Awaited<ReturnType<typeof listCorruptRunRecords>> = [];
    for (let batch = 0; batch < 10 && corrupt.length === 0; batch += 1) {
      corrupt = await listCorruptRunRecords({ directory: runsDir, inspectionBudget: 1 });
    }

    expect(corrupt).toEqual([
      expect.objectContaining({ runId: "torn", status: "corrupt", reason: "invalid JSON" })
    ]);
  });
});
