import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendRunModelEvent } from "@/lib/server/runs/run-model-event-log";
import { buildRunDiagnostics } from "@/lib/server/runs/diagnostics";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-diagnostics-"));
  process.env.MANYHANDS_RUNS_DIR = tempDir;
  resetRunRepositoryForTests();
});
afterEach(async () => { delete process.env.MANYHANDS_RUNS_DIR; resetRunRepositoryForTests(); await rm(tempDir, { recursive: true, force: true }); });

describe("B-032 run diagnostics", () => {
  it("exports correlated, redacted facts and disk categories without reading files manually", async () => {
    const runId = "run-diagnostics";
    await getRunRepository().save({ runId, workspaceId: "ws", granularity: "balanced", model: "sonnet", userPrompt: "x", title: "x", version: 1, status: "interrupted", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:01.000Z", patches: [], activeOperation: { operationId: "11111111-1111-4111-8111-111111111111", kind: "planning", fencingToken: 4, acquiredAt: "2026-07-12T00:00:00.000Z", heartbeatAt: "2026-07-12T00:00:01.000Z" } });
    await appendRunModelEvent(runId, { actor: "system", type: "plan.started", payload: {} });
    await writeFile(path.join(tempDir, "diagnostic.bin"), "secret-token=do-not-export", "utf8");

    const diagnostics = await buildRunDiagnostics(runId);
    expect(diagnostics.correlation).toMatchObject({ runId, operationId: "11111111-1111-4111-8111-111111111111", fencingToken: 4 });
    expect(diagnostics.eventLog.eventCount).toBe(1);
    expect(diagnostics.disk.totalBytes).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostics)).not.toContain("secret-token");
  });
});
