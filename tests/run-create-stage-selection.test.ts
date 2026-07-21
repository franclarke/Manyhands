import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as POST_RUNS } from "@/app/api/runs/route";
import { executionSelection, planningSelection, repairSelection } from "@/lib/server/runs/executor-selection";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";

let tempDir: string;
let previousClaude: string | undefined;
let previousCodex: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-stage-v2-"));
  previousClaude = process.env.MANYHANDS_CLAUDE_BIN;
  previousCodex = process.env.MANYHANDS_CODEX_BIN;
  const binary = await writeFakePlannerBin(tempDir);
  process.env.MANYHANDS_CLAUDE_BIN = binary;
  process.env.MANYHANDS_CODEX_BIN = binary;
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
});

afterEach(async () => {
  await drainAllRunBackgroundTasksForTests();
  if (previousClaude === undefined) delete process.env.MANYHANDS_CLAUDE_BIN;
  else process.env.MANYHANDS_CLAUDE_BIN = previousClaude;
  if (previousCodex === undefined) delete process.env.MANYHANDS_CODEX_BIN;
  else process.env.MANYHANDS_CODEX_BIN = previousCodex;
  delete process.env.MANYHANDS_WORKSPACES_FILE;
  delete process.env.MANYHANDS_RUNS_DIR;
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("POST /api/runs canonical StageSelection", () => {
  it("persists independent planning, execution and repair selections", async () => {
    const workspaceId = await createWorkspace();
    const response = await post({
      workspaceId,
      userPrompt: "Build it",
      planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "xhigh" },
      executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" },
      repairSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "high" }
    });
    expect(response.status).toBe(201);
    const { run } = (await response.json()) as { run: { runId: string } };
    const saved = await getRunRepository().get(run.runId);

    expect(planningSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "xhigh" });
    expect(executionSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
    expect(repairSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(saved.executionConfig.routing).toBe("fixed");
    expect(saved.targetContext.physicalIdentity).toBeDefined();
  });

  it("defaults execution and repair to the planning selection", async () => {
    const response = await post({
      workspaceId: await createWorkspace(),
      userPrompt: "Build it",
      planningSelection: { executorId: "claude-code-cli", model: "sonnet" }
    });
    expect(response.status).toBe(201);
    const { run } = (await response.json()) as { run: { runId: string } };
    const saved = await getRunRepository().get(run.runId);
    expect(saved.executionSelection).toEqual(saved.planningSelection);
    expect(saved.repairSelection).toEqual(saved.planningSelection);
  });

  it("rejects effort for a model that does not support it", async () => {
    const response = await post({
      workspaceId: await createWorkspace(),
      userPrompt: "Build it",
      executionSelection: { executorId: "claude-code-cli", model: "sonnet", effort: "high" }
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/effort/i);
  });

  it("accepts every selectable model for planning", async () => {
    const response = await post({
      workspaceId: await createWorkspace(),
      userPrompt: "Build it",
      planningSelection: { executorId: "claude-code-cli", model: "haiku" }
    });
    expect(response.status).toBe(201);
    const { run } = (await response.json()) as { run: { runId: string } };
    const saved = await getRunRepository().get(run.runId);
    expect(planningSelection(saved)).toEqual({ executorId: "claude-code-cli", model: "haiku" });
  });

  it("rejects unknown models instead of silently remapping them", async () => {
    const response = await post({
      workspaceId: await createWorkspace(),
      userPrompt: "Build it",
      planningSelection: { executorId: "codex-cli", model: "gpt-9-unregistered" }
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/unsupported/i);
  });

  it("rejects removed V1 create fields", async () => {
    const response = await post({
      workspaceId: await createWorkspace(),
      userPrompt: "Build it",
      granularity: "balanced",
      model: "gpt-5.5"
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/unrecognized/i);
  });
});

async function createWorkspace(): Promise<string> {
  const repoPath = path.join(tempDir, `repo-${randomUUID()}`);
  await mkdir(repoPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "test@manyhands.local"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "ManyHands Test"], { cwd: repoPath });
  await writeFile(path.join(repoPath, "README.md"), "# Test\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoPath });
  return (await getWorkspaceRepository().create({ name: "WS", repoPath })).id;
}

function post(body: unknown): Promise<Response> {
  return POST_RUNS(new Request("http://manyhands.test/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
}

async function writeFakePlannerBin(directory: string): Promise<string> {
  const output = JSON.stringify({ decision: "atomic", reason: "test", confidence: 1, validationCommands: [] });
  const file = path.join(directory, process.platform === "win32" ? "fake-planner.cmd" : "fake-planner.sh");
  const content = process.platform === "win32" ? `@echo off\r\necho ${output}\r\n` : `#!/bin/sh\nprintf '%s\\n' '${output}'\n`;
  await writeFile(file, content, "utf8");
  await chmod(file, 0o755).catch(() => undefined);
  return file;
}
