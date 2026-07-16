import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_RUNS } from "@/app/api/runs/route";
import { POST as POST_FORK } from "@/app/api/runs/[id]/fork/route";
import { DELETE as DELETE_WORKSPACE } from "@/app/api/workspaces/[id]/route";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import { RunNotFoundError } from "@/lib/server/runs/errors";
import { persistForkAtomically } from "@/lib/server/runs/fork-persistence";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";
import {
  WorkspaceNotFoundError,
  getWorkspaceRepository,
  resetWorkspaceRepositoryForTests
} from "@/lib/server/workspaces";

let tempDir: string;
let previousForceFallback: string | undefined;
let previousClaudeBin: string | undefined;
let previousCodexBin: string | undefined;
const execFileAsync = promisify(execFile);

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-workspace-refs-"));
  previousForceFallback = process.env.MANYHANDS_FORCE_FALLBACK;
  previousClaudeBin = process.env.MANYHANDS_CLAUDE_BIN;
  previousCodexBin = process.env.MANYHANDS_CODEX_BIN;
  process.env.MANYHANDS_FORCE_FALLBACK = "1";
  const bin = await writeFakeBin(tempDir);
  process.env.MANYHANDS_CLAUDE_BIN = bin;
  process.env.MANYHANDS_CODEX_BIN = bin;
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

describe("workspace/run reference integrity", () => {
  it("returns an actionable 409 and preserves a workspace referenced by a run", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Referenced" });
    await getRunRepository().save(runRecord("referencing-run", workspace.id));

    const response = await deleteWorkspace(workspace.id);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/referencing-run|purge|referenced/i);
    await expect(getWorkspaceRepository().get(workspace.id)).resolves.toMatchObject({ id: workspace.id });
  });

  it("linearizes public run creation against workspace deletion without a dangling reference", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Racing" });
    const [createResponse, deleteResponse] = await Promise.all([
      createRun(workspace.id),
      deleteWorkspace(workspace.id)
    ]);

    if (createResponse.status === 201) {
      expect(deleteResponse.status).toBe(409);
      const payload = (await createResponse.json()) as { run: { runId: string } };
      expect((await getRunRepository().get(payload.run.runId)).workspaceId).toBe(workspace.id);
      await expect(getWorkspaceRepository().get(workspace.id)).resolves.toMatchObject({ id: workspace.id });
    } else {
      expect(createResponse.status).toBe(404);
      expect(deleteResponse.status).toBe(204);
      await expect(getWorkspaceRepository().get(workspace.id)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    }
  });

  it("fails closed without modifying a workspace when any RunRecord is corrupt", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Protected by corrupt run" });
    await getWorkspaceRepository().create({ name: "Spare workspace" });
    await getRunRepository().save(runRecord("corrupt-reference", workspace.id));
    const corruptPath = path.join(process.env.MANYHANDS_RUNS_DIR!, "corrupt-reference.json");
    await writeFile(corruptPath, "{ invalid", "utf8");

    const response = await deleteWorkspace(workspace.id);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/diagnostics|repair|safely inspect|no workspace data was deleted/i);
    await expect(getWorkspaceRepository().get(workspace.id)).resolves.toMatchObject({ id: workspace.id });
    expect(await readFile(corruptPath, "utf8")).toBe("{ invalid");
  });

  it("does not publish a fork RunRecord when checkpoint cloning fails", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Fork transaction" });
    let cleanupCalls = 0;
    const forkedRun = runRecord("failed-fork-publication", workspace.id);

    await expect(
      persistForkAtomically({
        sourceWorkspaceId: workspace.id,
        forkedRun,
        cloneCheckpoint: async () => {
          throw new Error("simulated checkpoint write failure");
        },
        cleanupCheckpoint: async () => {
          cleanupCalls += 1;
        }
      })
    ).rejects.toThrow(/checkpoint write failure/i);

    expect(cleanupCalls).toBe(1);
    await expect(getRunRepository().get(forkedRun.runId)).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(getWorkspaceRepository().get(workspace.id)).resolves.toMatchObject({ id: workspace.id });
  });

  it("compensates a saved fork when the source lease is fenced before publication commits", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Fenced fork transaction" });
    const forkedRun = runRecord("fenced-fork-publication", workspace.id);
    let checkpointCloned = false;
    let cleanupCalls = 0;

    await expect(
      persistForkAtomically({
        sourceWorkspaceId: workspace.id,
        forkedRun,
        cloneCheckpoint: async () => {
          checkpointCloned = true;
        },
        cleanupCheckpoint: async () => {
          cleanupCalls += 1;
          checkpointCloned = false;
        },
        validateAfterSave: async () => {
          // Models cancellation fencing the source after child save but before
          // the fork publication reaches its linearization point.
          throw new Error("source fork lease was fenced");
        }
      })
    ).rejects.toThrow(/source fork lease was fenced/i);

    expect(checkpointCloned).toBe(false);
    expect(cleanupCalls).toBe(1);
    await expect(getRunRepository().get(forkedRun.runId)).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("never rolls back a pre-existing run id that the fork operation does not own", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Fork ownership" });
    const existing = await getRunRepository().save(runRecord("existing-run-id", workspace.id));
    let cloneCalls = 0;
    let cleanupCalls = 0;

    await expect(
      persistForkAtomically({
        sourceWorkspaceId: workspace.id,
        forkedRun: runRecord(existing.runId, workspace.id),
        cloneCheckpoint: async () => {
          cloneCalls += 1;
        },
        cleanupCheckpoint: async () => {
          cleanupCalls += 1;
        }
      })
    ).rejects.toThrow(/already exists|not owned/i);

    expect(cloneCalls).toBe(0);
    expect(cleanupCalls).toBe(0);
    await expect(getRunRepository().get(existing.runId)).resolves.toMatchObject({
      runId: existing.runId,
      title: existing.title
    });
  });

  it.each(["create", "fork"] as const)(
    "linearizes the %s publication seam against delete across two OS processes",
    async (publicationAction) => {
      const workspace = await getWorkspaceRepository().create({ name: "Two process race" });
      await getWorkspaceRepository().create({ name: "Deletion guard spare" });
      const childBundle = path.join(tempDir, "workspace-reference-child.cjs");
      await bundleReferenceChild(childBundle);
      const gatePath = path.join(tempDir, "reference-race-gate");
      const runId = "cross-process-run";
      const children = [
        spawnReferenceChild(childBundle, workspace.id, runId, publicationAction, "publisher", gatePath),
        spawnReferenceChild(childBundle, workspace.id, runId, "delete", "deleter", gatePath)
      ];
      await Promise.all([
        waitForPath(`${gatePath}.publisher.ready`),
        waitForPath(`${gatePath}.deleter.ready`)
      ]);
      await writeFile(gatePath, "go", "utf8");
      await Promise.all(children.map(waitForChild));

      const publisher = await readChildOutcome(`${gatePath}.publisher.result.json`);
      const deleter = await readChildOutcome(`${gatePath}.deleter.result.json`);
      const workspaceExists = await getWorkspaceRepository().get(workspace.id).then(
        () => true,
        (error: unknown) => {
          if (error instanceof WorkspaceNotFoundError) return false;
          throw error;
        }
      );
      const runExists = await getRunRepository().get(runId).then(
        () => true,
        (error: unknown) => {
          if (error instanceof RunNotFoundError) return false;
          throw error;
        }
      );

      const publishedOutcome = publicationAction === "create" ? "created" : "forked";
      expect([publisher, deleter]).toEqual(
        publisher === publishedOutcome
          ? [publishedOutcome, "reference_exists"]
          : ["workspace_missing", "deleted"]
      );
      expect(runExists && !workspaceExists).toBe(false);
      expect(runExists).toBe(workspaceExists && publisher === publishedOutcome);
    },
    30_000
  );

  it("returns 409 instead of 500 when a legacy run's workspace is missing during fork", async () => {
    const workspace = await getWorkspaceRepository().create({ name: "Removed" });
    const run = await getRunRepository().save(runRecord("orphan-source", workspace.id));
    // Simulate a legacy dangling record that predates the guarded DELETE route.
    await getWorkspaceRepository().delete(workspace.id);

    const response = await POST_FORK(
      new Request(`http://manyhands.test/api/runs/${run.runId}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: run.runId }) }
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/workspace no longer exists|restore/i);
  });
});

async function createRun(workspaceId: string): Promise<Response> {
  return POST_RUNS(
    new Request("http://manyhands.test/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        granularity: "balanced",
        model: "gpt-5.5",
        planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" },
        executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" },
        userPrompt: "Build it"
      })
    })
  );
}

async function deleteWorkspace(id: string): Promise<Response> {
  return DELETE_WORKSPACE(
    new Request(`http://manyhands.test/api/workspaces/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) }
  );
}

async function bundleReferenceChild(output: string): Promise<void> {
  const esbuildCli = await findEsbuildCli();
  await execFileAsync(process.execPath, [
    esbuildCli,
    path.resolve("tests/helpers/workspace-reference-child.ts"),
    `--outfile=${output}`,
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--log-level=silent",
    `--tsconfig=${path.resolve("tsconfig.json")}`
  ]);
}

function spawnReferenceChild(
  bundle: string,
  workspaceId: string,
  runId: string,
  action: "create" | "fork" | "delete",
  participant: string,
  gatePath: string
): ReturnType<typeof spawn> {
  return spawn(
    process.execPath,
    [
      bundle,
      process.env.MANYHANDS_WORKSPACES_FILE!,
      process.env.MANYHANDS_RUNS_DIR!,
      workspaceId,
      runId,
      action,
      participant,
      gatePath
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
  );
}

async function waitForPath(target: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await access(target);
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${target}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function waitForChild(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Workspace reference child exited ${code ?? signal}: ${stderr}`));
    });
  });
}

async function readChildOutcome(filePath: string): Promise<string> {
  const value = JSON.parse(await readFile(filePath, "utf8")) as { outcome?: unknown };
  if (typeof value.outcome !== "string") throw new Error(`Invalid child outcome at ${filePath}`);
  return value.outcome;
}

async function findEsbuildCli(): Promise<string> {
  const store = path.resolve("node_modules/.pnpm");
  const packageDirectory = (await readdir(store)).find((entry) => entry.startsWith("esbuild@"));
  if (packageDirectory === undefined) throw new Error(`esbuild package is missing under ${store}`);
  return path.join(store, packageDirectory, "node_modules", "esbuild", "bin", "esbuild");
}

function runRecord(runId: string, workspaceId: string): RunRecord {
  return {
    runId,
    workspaceId,
    granularity: "balanced",
    model: "gpt-5.5",
    userPrompt: "Build it",
    title: runId,
    version: 0,
    status: "failed",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    patches: []
  };
}

async function writeFakeBin(directory: string): Promise<string> {
  const output = JSON.stringify({ title: "Generated title", summary: "Generated summary." });
  const file = path.join(directory, process.platform === "win32" ? "fake-provider.cmd" : "fake-provider.sh");
  const content = process.platform === "win32"
    ? `@echo off\r\necho ${output}\r\n`
    : `#!/bin/sh\nprintf '%s\\n' '${output}'\n`;
  await writeFile(file, content, "utf8");
  await chmod(file, 0o755).catch(() => undefined);
  return file;
}
