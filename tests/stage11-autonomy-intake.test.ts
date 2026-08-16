import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ProductRunCommand, ProductRunDefinition, RunProjection } from "@manyhands/run-coordinator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const daemon = vi.hoisted(() => ({ command: undefined as ProductRunCommand | undefined }));
vi.mock("@/lib/server/daemon/productive-client", () => ({
  commandIdForRequest: () => "command:test-autonomy",
  runIdForCreateCommand: () => "run:test-autonomy",
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
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-stage11-autonomy-"));
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  daemon.command = undefined;
  resetWorkspaceRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_WORKSPACES_FILE;
  resetWorkspaceRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

/**
 * The autonomy select has been on the run form since the first product screen
 * and its value never left the browser: it was React state nothing read. The
 * delegation has to reach the durable definition, because that definition is
 * the only thing the daemon can reconstruct a run from after a restart.
 */
describe("POST /api/runs autonomy", () => {
  it("carries the level the operator chose into the durable definition", async () => {
    const response = await post({
      workspaceId: await createWorkspace(),
      userPrompt: "Build it",
      autonomy: "autonomous"
    });

    expect(response.status).toBe(201);
    expect(createdDefinition().autonomy).toBe("autonomous");
  });

  it("says nothing rather than guessing when the client sends no level", async () => {
    // An absent field reads as `supervised` everywhere it is consulted. Writing
    // a default into the journal instead would put a delegation on the record
    // that the operator never made.
    const response = await post({ workspaceId: await createWorkspace(), userPrompt: "Build it" });

    expect(response.status).toBe(201);
    expect(createdDefinition().autonomy).toBeUndefined();
  });

  it("rejects a level the policy does not define", async () => {
    const response = await post({
      workspaceId: await createWorkspace(),
      userPrompt: "Build it",
      autonomy: "full-send"
    });

    expect(response.status).toBe(400);
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
    runId: "run:test-autonomy", goal: definition.userPrompt, definition, title: definition.title,
    lifecycle: "planning", sequence: 2, createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z", appliedEventIds: [], commandReceipts: {},
    commandEnvelopes: {}, effectIntents: {}, physicalEffectReceipts: {}, effectTerminals: {},
    decisions: {}, readiness: { readyNodeIds: [], pendingDecisionIds: [] }, selectedWaves: [],
    attempts: {}, adoptedArtifacts: {}, nodeEvidenceMatrixIds: {}, integrations: {},
    recoveryHistory: [], evidenceMatrices: [], evidenceMatrixSummaries: {},
    outcomes: { execution: "pending", artifact: "missing", delivery: "not_started" }
  };
}
