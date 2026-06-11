import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepRunIfStale, DEFAULT_STALE_MS } from "@/lib/server/runs/interrupted";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-sweep-"));
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_RUNS_DIR;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

function makeRun(overrides: Record<string, unknown> = {}): import("@/lib/server/runs/schema").RunRecord {
  const base: import("@/lib/server/runs/schema").RunRecord = {
    runId: "run-stale",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-test",
    userPrompt: "",
    title: "stale",
    version: 0,
    status: "generating",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    patches: []
  };
  return { ...base, ...overrides };
}

describe("sweepRunIfStale", () => {
  // sweepRunIfStale calls Date.now(); we cannot inject. Instead we set
  // updatedAt/heartbeatAt to a date one hour in the past relative to the
  // wall clock, so the diff is ~3600s which is well above DEFAULT_STALE_MS.
  function pastIso(minutesAgo: number): string {
    return new Date(Date.now() - minutesAgo * 60_000).toISOString();
  }

  it("marks generating runs without recent heartbeat as interrupted", async () => {
    const directory = process.env.MANYHANDS_RUNS_DIR!;
    const oldIso = pastIso(60);
    const store = new JsonRunRecordStore({ directory, clock: () => oldIso });
    const stale = makeRun({
      updatedAt: oldIso,
      heartbeatAt: oldIso
    });
    await store.save(stale);
    const fetched = await store.get(stale.runId);
    const swept = await sweepRunIfStale(fetched, DEFAULT_STALE_MS);
    expect(swept.status).toBe("interrupted");
    expect(swept.interruptedDuring).toBe("generating");
    expect(swept.errorMessage).toContain("interrupted");
  });

  it("keeps fresh generating runs untouched", async () => {
    const directory = process.env.MANYHANDS_RUNS_DIR!;
    const store = new JsonRunRecordStore({ directory });
    const fresh = makeRun({
      heartbeatAt: new Date().toISOString()
    });
    await store.save(fresh);
    const fetched = await store.get(fresh.runId);
    const swept = await sweepRunIfStale(fetched, DEFAULT_STALE_MS);
    expect(swept.status).toBe("generating");
  });

  it("ignores terminal statuses", async () => {
    const directory = process.env.MANYHANDS_RUNS_DIR!;
    const oldIso = pastIso(60);
    const store = new JsonRunRecordStore({ directory, clock: () => oldIso });
    const completed = makeRun({ status: "completed", updatedAt: oldIso });
    await store.save(completed);
    const fetched = await store.get(completed.runId);
    const swept = await sweepRunIfStale(fetched, DEFAULT_STALE_MS);
    expect(swept.status).toBe("completed");
  });
});
