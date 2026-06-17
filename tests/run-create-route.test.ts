import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_RUNS } from "@/app/api/runs/route";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-create-"));
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

describe("POST /api/runs", () => {
  it("persists the selected model as fixed execution and repair routing", async () => {
    const workspace = await getWorkspaceRepository().create({
      name: "Test workspace",
      repoPath: "C:/repo"
    });

    const response = await POST_RUNS(
      new Request("http://manyhands.test/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          granularity: "balanced",
          model: "gpt-5.5",
          planningModel: "gpt-5.5",
          planningExecutorId: "codex-cli",
          defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
          defaultRepairSelection: { executorId: "codex-cli", model: "gpt-5.5" },
          userPrompt: "Build a calculator"
        })
      })
    );

    const payload = (await response.json()) as { run?: { runId?: string } };

    expect(response.status).toBe(201);
    expect(payload.run?.runId).toBeDefined();
    const saved = await getRunRepository().get(payload.run!.runId!);
    expect(saved.defaultExecutionSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(saved.defaultRepairSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(saved.executionConfig?.routing).toBe("fixed");
  });

  it("rejects a planning model that does not belong to its executor", async () => {
    const workspace = await getWorkspaceRepository().create({
      name: "Test workspace",
      repoPath: "C:/repo"
    });

    const response = await POST_RUNS(
      new Request("http://manyhands.test/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          granularity: "balanced",
          model: "gpt-5.5",
          planningModel: "gpt-5.5",
          planningExecutorId: "claude-code-cli",
          defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
          userPrompt: "Build a calculator"
        })
      })
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toContain('Unsupported executor/model selection "claude-code-cli/gpt-5.5"');
  });
});
