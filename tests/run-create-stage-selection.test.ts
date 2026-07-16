import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_RUNS } from "@/app/api/runs/route";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import { executionSelection, planningSelection, repairSelection } from "@/lib/server/runs/executor-selection";

let tempDir: string;
let prevForce: string | undefined;
let prevClaude: string | undefined;
let prevCodex: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-stage-"));
  prevForce = process.env.MANYHANDS_FORCE_FALLBACK;
  prevClaude = process.env.MANYHANDS_CLAUDE_BIN;
  prevCodex = process.env.MANYHANDS_CODEX_BIN;
  process.env.MANYHANDS_FORCE_FALLBACK = "1";
  const bin = await writeFakeTitlerBin(tempDir);
  process.env.MANYHANDS_CLAUDE_BIN = bin;
  process.env.MANYHANDS_CODEX_BIN = bin;
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
});

afterEach(async () => {
  await drainAllRunBackgroundTasksForTests();
  if (prevForce === undefined) delete process.env.MANYHANDS_FORCE_FALLBACK;
  else process.env.MANYHANDS_FORCE_FALLBACK = prevForce;
  if (prevClaude === undefined) delete process.env.MANYHANDS_CLAUDE_BIN;
  else process.env.MANYHANDS_CLAUDE_BIN = prevClaude;
  if (prevCodex === undefined) delete process.env.MANYHANDS_CODEX_BIN;
  else process.env.MANYHANDS_CODEX_BIN = prevCodex;
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

async function createWorkspace(): Promise<string> {
  const workspace = await getWorkspaceRepository().create({ name: "WS" });
  return workspace.id;
}

async function post(body: unknown): Promise<Response> {
  return POST_RUNS(
    new Request("http://manyhands.test/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

describe("POST /api/runs — canonical StageSelection (U2A-2)", () => {
  it("persists independent planning/execution efforts (Codex xhigh planning + Codex medium execution)", async () => {
    const workspaceId = await createWorkspace();
    const res = await post({
      workspaceId,
      granularity: "balanced",
      userPrompt: "Build it",
      model: "gpt-5.5",
      planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "xhigh" },
      executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" }
    });
    expect(res.status).toBe(201);
    const { run } = (await res.json()) as { run: { runId: string } };
    const saved = await getRunRepository().get(run.runId);

    // Canonical persisted with independent efforts.
    expect(saved.planningSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "xhigh" });
    expect(saved.executionSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
    // Legacy mirror kept for back-compat.
    expect(saved.planningExecutorId).toBe("codex-cli");
    expect(saved.defaultExecutionSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    // Resolver reads them back as effective — selected == persisted == effective.
    expect(planningSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "xhigh" });
    expect(executionSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
  });

  it("supports Codex planning (high) with Claude execution (no effort)", async () => {
    const workspaceId = await createWorkspace();
    const res = await post({
      workspaceId,
      granularity: "balanced",
      userPrompt: "Build it",
      model: "sonnet",
      planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "high" },
      executionSelection: { executorId: "claude-code-cli", model: "sonnet" }
    });
    expect(res.status).toBe(201);
    const { run } = (await res.json()) as { run: { runId: string } };
    const saved = await getRunRepository().get(run.runId);
    expect(planningSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(executionSelection(saved)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(repairSelection(saved)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
  });

  it("supports Claude planning with Codex execution (low)", async () => {
    const workspaceId = await createWorkspace();
    const res = await post({
      workspaceId,
      granularity: "balanced",
      userPrompt: "Build it",
      model: "gpt-5.5",
      planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
      executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "low" }
    });
    expect(res.status).toBe(201);
    const { run } = (await res.json()) as { run: { runId: string } };
    const saved = await getRunRepository().get(run.runId);
    expect(planningSelection(saved)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(executionSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "low" });
  });

  it("rejects an effort sent to a model that does not support effort (Claude)", async () => {
    const workspaceId = await createWorkspace();
    const res = await post({
      workspaceId,
      granularity: "balanced",
      userPrompt: "Build it",
      model: "sonnet",
      executionSelection: { executorId: "claude-code-cli", model: "sonnet", effort: "high" }
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/effort/i);
  });

  it("rejects an effort value the model does not allow", async () => {
    const workspaceId = await createWorkspace();
    const res = await post({
      workspaceId,
      granularity: "balanced",
      userPrompt: "Build it",
      model: "gpt-5.5",
      executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "extreme" }
    });
    expect(res.status).toBe(400);
  });

  it("rejects a canonical planning model without planning capability", async () => {
    const workspaceId = await createWorkspace();
    const res = await post({
      workspaceId,
      granularity: "balanced",
      userPrompt: "Build it",
      model: "sonnet",
      planningSelection: { executorId: "claude-code-cli", model: "haiku" },
      executionSelection: { executorId: "claude-code-cli", model: "sonnet" }
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/planning/i);
  });

  it("rejects an unknown/unregistered model at the request boundary (F8: no silent remap for new runs)", async () => {
    const workspaceId = await createWorkspace();
    const res = await post({
      workspaceId,
      granularity: "balanced",
      userPrompt: "Build it",
      model: "gpt-9-ultra-unregistered"
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/unsupported/i);
  });

  it("rejects contradictory canonical and legacy fields for the same stage", async () => {
    const workspaceId = await createWorkspace();
    const res = await post({
      workspaceId,
      granularity: "balanced",
      userPrompt: "Build it",
      model: "gpt-5.5",
      executionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
      defaultExecutionSelection: { executorId: "claude-code-cli", model: "sonnet" }
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/contradict/i);
  });
});
