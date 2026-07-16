import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExecutionConfigSchema } from "@manyhands/execution-core";
import { POST as POST_FORK } from "@/app/api/runs/[id]/fork/route";
import { effectiveExecutionConfig } from "@/lib/server/runs/effective-execution-config";
import { RunCreateRequestSchema } from "@/lib/server/runs/schema";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";

describe("fixed product routing with legacy reads", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-routing-"));
    process.env.MANYHANDS_RUNS_DIR = directory;
    resetRunRepositoryForTests();
  });

  afterEach(async () => {
    delete process.env.MANYHANDS_RUNS_DIR;
    resetRunRepositoryForTests();
    await rm(directory, { recursive: true, force: true });
  });

  it("defaults missing legacy config to fixed while still parsing explicit historical complexity", () => {
    expect(effectiveExecutionConfig(undefined).routing).toBe("fixed");
    expect(ExecutionConfigSchema.parse({ routing: "complexity" }).routing).toBe("complexity");
  });

  it("rejects attempts to create a new run with the dormant complexity mode", () => {
    const parsed = RunCreateRequestSchema.safeParse({
      workspaceId: "ws",
      granularity: "balanced",
      model: "gpt-5.5",
      executionConfig: { routing: "complexity" },
      userPrompt: "build it"
    });
    expect(parsed.success).toBe(false);
  });

  it("migrates an explicitly-complexity legacy run to fixed when forking", async () => {
    const source = await getRunRepository().save({
      runId: "legacy-complexity",
      workspaceId: "ws",
      granularity: "balanced",
      model: "gpt-5.5",
      userPrompt: "build it",
      title: "Legacy",
      version: 0,
      status: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      patches: [],
      executionConfig: { routing: "complexity" }
    });

    const response = await POST_FORK(
      new Request(`http://localhost/api/runs/${source.runId}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: source.runId }) }
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { newRunId: string };
    expect((await getRunRepository().get(body.newRunId)).executionConfig?.routing).toBe("fixed");
  });
});
