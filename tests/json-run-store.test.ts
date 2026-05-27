import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMockExecutionFlow } from "@manyhands/core";
import {
  JsonRunStore,
  RunSnapshotSchema,
  readRunSnapshotFile,
  writeRunSnapshotFile
} from "@manyhands/run-store";
import { InMemoryTraceStore } from "@manyhands/trace-store";

const fixturePath = path.resolve(process.cwd(), "examples/features/passwordless-login.json");

async function makeTempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "manyhands-run-store-"));
}

describe("JsonRunStore", () => {
  it("exports a run snapshot to parseable JSON", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });
    const directory = await makeTempDirectory();
    const filePath = path.join(directory, "run.json");

    await writeRunSnapshotFile(result.snapshot, filePath);

    const imported = await readRunSnapshotFile(filePath);
    expect(RunSnapshotSchema.safeParse(imported).success).toBe(true);
    expect(imported.runId).toBe(result.snapshot.runId);
  });

  it("imports a valid JSON snapshot into the store", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });
    const directory = await makeTempDirectory();
    const store = new JsonRunStore({ directory });

    await store.importRun(result.snapshot);

    const reloaded = await store.getRunSnapshot(result.snapshot.runId);
    expect(reloaded?.runId).toBe(result.snapshot.runId);
    expect(await store.listRunSnapshots()).toHaveLength(1);
  });

  it("fails clearly when importing invalid JSON", async () => {
    const directory = await makeTempDirectory();
    const invalidPath = path.join(directory, "invalid.json");

    await writeFile(invalidPath, JSON.stringify({ runId: "bad-run" }), "utf8");

    await expect(readRunSnapshotFile(invalidPath)).rejects.toThrow();
  });

  it("keeps the trace store interface usable", () => {
    const store = new JsonRunStore({ traceStore: new InMemoryTraceStore() });

    store.append({
      type: "graph_created",
      actor: "system",
      planId: "plan-1",
      payload: {
        graphId: "graph-1"
      }
    });

    expect(store.list()).toHaveLength(1);
    expect(store.findByType("graph_created")).toHaveLength(1);
  });

  it("stores coarse, balanced and fine runs as separate artifacts", async () => {
    const directory = await makeTempDirectory();
    const store = new JsonRunStore({ directory });
    const modes = ["coarse", "balanced", "fine"] as const;

    for (const mode of modes) {
      const result = await runMockExecutionFlow({ fixturePath, mode });
      await store.saveRunSnapshot(result.snapshot);
    }

    const runs = await store.listRunSnapshots();
    expect(runs.map((run) => run.decompositionMode).sort()).toEqual(["balanced", "coarse", "fine"]);
    expect(new Set(runs.map((run) => run.runId)).size).toBe(3);
  });
});
