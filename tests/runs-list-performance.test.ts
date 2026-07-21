import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as GET_RUNS } from "@/app/api/runs/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

let tempDir: string;
let previousRunsDir: string | undefined;

function makeRun(runId: string): RunRecord {
  return makeRunRecordV2({ runId, workspaceId: "missing-workspace", title: runId, lifecycle: "completed" });
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-runs-list-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
  for (let index = 0; index < 12; index += 1) {
    await getRunRepository().save(makeRun(`run-${index}`));
  }
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("GET /api/runs hot path", () => {
  it("does not start a corruption crawl for the dev console poll", async () => {
    const response = await GET_RUNS(new Request("http://localhost/api/runs?limit=5"));
    expect(response.status).toBe(200);
    expect((await response.json()).runs).toHaveLength(5);
    await expect(
      stat(path.join(process.env.MANYHANDS_RUNS_DIR!, ".diagnostics", "run-record-index.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fills the requested recent-runs slice after excluding archived records", async () => {
    await getRunRepository().update("run-11", (current) => ({
      ...current,
      archivedAt: "2026-07-18T21:00:00.000Z"
    }));

    const response = await GET_RUNS(new Request("http://localhost/api/runs?limit=5"));
    expect(response.status).toBe(200);
    const payload = await response.json() as { runs: Array<{ id: string }> };

    expect(payload.runs).toHaveLength(5);
    expect(payload.runs.map((run) => run.id)).not.toContain("run-11");
  });

  it("ignores retired diagnostics query flags without starting a crawl", async () => {
    const response = await GET_RUNS(
      new Request("http://localhost/api/runs?limit=5&diagnostics=refresh")
    );
    expect(response.status).toBe(200);
    await expect(
      stat(path.join(process.env.MANYHANDS_RUNS_DIR!, ".diagnostics", "run-record-index.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
