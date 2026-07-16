import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_RUNS } from "@/app/api/runs/route";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";

let tempDir: string;
let previousForceFallback: string | undefined;
let previousClaudeBin: string | undefined;
let previousCodexBin: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-create-"));
  previousForceFallback = process.env.MANYHANDS_FORCE_FALLBACK;
  previousClaudeBin = process.env.MANYHANDS_CLAUDE_BIN;
  previousCodexBin = process.env.MANYHANDS_CODEX_BIN;
  process.env.MANYHANDS_FORCE_FALLBACK = "1";
  const fakeTitler = await writeFakeTitlerBin(tempDir);
  process.env.MANYHANDS_CLAUDE_BIN = fakeTitler;
  process.env.MANYHANDS_CODEX_BIN = fakeTitler;
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
});

afterEach(async () => {
  await drainAllRunBackgroundTasksForTests();
  if (previousForceFallback === undefined) delete process.env.MANYHANDS_FORCE_FALLBACK;
  else process.env.MANYHANDS_FORCE_FALLBACK = previousForceFallback;
  if (previousClaudeBin === undefined) delete process.env.MANYHANDS_CLAUDE_BIN;
  else process.env.MANYHANDS_CLAUDE_BIN = previousClaudeBin;
  if (previousCodexBin === undefined) delete process.env.MANYHANDS_CODEX_BIN;
  else process.env.MANYHANDS_CODEX_BIN = previousCodexBin;
  delete process.env.MANYHANDS_WORKSPACES_FILE;
  delete process.env.MANYHANDS_RUNS_DIR;
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFakeTitlerBin(dir: string): Promise<string> {
  const output = JSON.stringify({ title: "Generated title", summary: "Generated summary." });
  const file = path.join(dir, process.platform === "win32" ? "fake-titler.cmd" : "fake-titler.sh");
  const content = process.platform === "win32" ? `@echo off\r\necho ${output}\r\n` : `#!/bin/sh\nprintf '%s\\n' '${output}'\n`;
  await writeFile(file, content, "utf8");
  await chmod(file, 0o755).catch(() => undefined);
  return file;
}

describe("POST /api/runs", () => {
  it("persists separate planning and execution selections with fixed routing", async () => {
    const workspace = await getWorkspaceRepository().create({
      name: "Test workspace"
    });

    const response = await POST_RUNS(
      new Request("http://manyhands.test/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          granularity: "balanced",
          model: "gpt-5.5",
          planningModel: "sonnet",
          planningExecutorId: "claude-code-cli",
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
    expect(saved.model).toBe("gpt-5.5");
    expect(saved.planningModel).toBe("sonnet");
    expect(saved.planningExecutorId).toBe("claude-code-cli");
    expect(saved.defaultExecutionSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(saved.defaultRepairSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(saved.executionConfig).toMatchObject({ routing: "fixed", reasoningEffort: "medium" });
  });

  it("persists the requested reasoning effort in execution config", async () => {
    const workspace = await getWorkspaceRepository().create({
      name: "Test workspace"
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
          executionConfig: { reasoningEffort: "medium" },
          userPrompt: "Build a calculator"
        })
      })
    );

    const payload = (await response.json()) as { run?: { runId?: string } };

    expect(response.status).toBe(201);
    const saved = await getRunRepository().get(payload.run!.runId!);
    expect(saved.executionConfig).toMatchObject({
      routing: "fixed",
      reasoningEffort: "medium"
    });
  });

  it("uses the initial planning selection as canonical when execution selections are omitted", async () => {
    const workspace = await getWorkspaceRepository().create({
      name: "Test workspace"
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
          userPrompt: "Build a calculator"
        })
      })
    );

    const payload = (await response.json()) as { run?: { runId?: string } };

    expect(response.status).toBe(201);
    const saved = await getRunRepository().get(payload.run!.runId!);
    expect(saved.model).toBe("gpt-5.5");
    expect(saved.planningExecutorId).toBe("codex-cli");
    expect(saved.defaultExecutionSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(saved.defaultRepairSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(saved.executionConfig?.routing).toBe("fixed");
  });

  it("rejects a planning model that does not belong to its executor", async () => {
    const workspace = await getWorkspaceRepository().create({
      name: "Test workspace"
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

  it("rejects a planning model that does not support planning", async () => {
    const workspace = await getWorkspaceRepository().create({
      name: "Test workspace"
    });

    const response = await POST_RUNS(
      new Request("http://manyhands.test/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          granularity: "balanced",
          model: "haiku",
          planningModel: "haiku",
          planningExecutorId: "claude-code-cli",
          defaultExecutionSelection: { executorId: "claude-code-cli", model: "haiku" },
          userPrompt: "Build a calculator"
        })
      })
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toContain('Planning selection "claude-code-cli/haiku" does not support planning.');
  });
});
