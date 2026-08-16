import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProductRunCommand, ProductRunDefinition, RunProjection } from "@manyhands/run-coordinator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const daemon = vi.hoisted(() => ({ command: undefined as ProductRunCommand | undefined }));
vi.mock("@/lib/server/daemon/productive-client", () => ({
  commandIdForRequest: () => "command:test-create",
  runIdForCreateCommand: () => "run:test-create",
  submitProductRunCommand: async (input: { command: ProductRunCommand }) => {
    daemon.command = input.command;
    const definition = (input.command as Extract<ProductRunCommand, { type: "create_run" }>).definition;
    return { receipt: {}, projection: projection(definition) };
  },
  listProductRuns: vi.fn()
}));

import { POST as POST_RUNS } from "@/app/api/runs/route";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-stage-v2-"));
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  daemon.command = undefined;
  resetWorkspaceRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_WORKSPACES_FILE;
  resetWorkspaceRepositoryForTests();
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
    const definition = createdDefinition();
    expect(definition.planningSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "xhigh" });
    expect(definition.executionSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
    expect(definition.repairSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(definition.executionConfig.routing).toBe("fixed");
    expect(definition.targetContext.physicalIdentity).toBeDefined();
  });

  it("defaults execution and repair to the planning selection", async () => {
    const response = await post({
      workspaceId: await createWorkspace(),
      userPrompt: "Build it",
      planningSelection: { executorId: "claude-code-cli", model: "sonnet" }
    });
    expect(response.status).toBe(201);
    const definition = createdDefinition();
    expect(definition.executionSelection).toEqual(definition.planningSelection);
    expect(definition.repairSelection).toEqual(definition.planningSelection);
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
    expect(createdDefinition().planningSelection).toEqual({ executorId: "claude-code-cli", model: "haiku" });
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

function createdDefinition(): ProductRunDefinition {
  expect(daemon.command?.type).toBe("create_run");
  return (daemon.command as Extract<ProductRunCommand, { type: "create_run" }>).definition;
}

function projection(definition: ProductRunDefinition): RunProjection {
  return {
    runId: "run:test-create", goal: definition.userPrompt, definition, title: definition.title,
    lifecycle: "planning", sequence: 2, createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z", appliedEventIds: [], commandReceipts: {},
    commandEnvelopes: {}, effectIntents: {}, physicalEffectReceipts: {}, effectTerminals: {},
    decisions: {}, humanReviews: {}, readiness: { readyNodeIds: [], pendingDecisionIds: [] }, selectedWaves: [],
    attempts: {}, adoptedArtifacts: {}, nodeEvidenceMatrixIds: {}, integrations: {},
    recoveryHistory: [], evidenceMatrices: [], evidenceMatrixSummaries: {},
    outcomes: { execution: "pending", artifact: "missing", delivery: "not_started" }
  };
}
