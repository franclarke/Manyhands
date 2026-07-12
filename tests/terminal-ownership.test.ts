/**
 * B-006 — terminal ownership per run (CF-41).
 *
 * A terminal id must only be usable under the run that created it: input,
 * resize, stream and delete against another run's id answer 404 and never
 * touch the session.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_CREATE } from "@/app/api/runs/[id]/terminals/route";
import { POST as POST_INPUT } from "@/app/api/runs/[id]/terminals/[terminalId]/input/route";
import { DELETE as DELETE_TERMINAL } from "@/app/api/runs/[id]/terminals/[terminalId]/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { closeTerminalSession } from "@/lib/server/runs/terminal-sessions";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;
const openSessions: string[] = [];

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-term-own-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  for (const id of openSessions.splice(0)) closeTerminalSession(id);
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-sonnet",
    userPrompt: "x",
    title: "x",
    version: 0,
    status: "completed",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    patches: [],
    provisioned: {
      repoRoot: tempDir,
      baseBranch: "main",
      baseCommit: "abc",
      provisionedAt: "2026-07-12T00:00:00.000Z"
    }
  };
}

async function createSession(runId: string): Promise<string> {
  const response = await POST_CREATE(
    new Request("http://localhost", { method: "POST", body: JSON.stringify({}) }),
    { params: Promise.resolve({ id: runId }) }
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { session: { id: string } };
  openSessions.push(body.session.id);
  return body.session.id;
}

describe("B-006 terminal ownership", () => {
  it("input under the wrong run answers 404 and the owner keeps working", async () => {
    await getRunRepository().save(makeRun("run-owner"));
    await getRunRepository().save(makeRun("run-intruder"));
    const terminalId = await createSession("run-owner");

    const crossRun = await POST_INPUT(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ data: "echo hacked\r" }) }),
      { params: Promise.resolve({ id: "run-intruder", terminalId }) }
    );
    expect(crossRun.status).toBe(404);

    const owner = await POST_INPUT(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ data: "echo ok\r" }) }),
      { params: Promise.resolve({ id: "run-owner", terminalId }) }
    );
    expect(owner.status).toBe(200);
  }, 30_000);

  it("delete under the wrong run answers 404 and does not close the session", async () => {
    await getRunRepository().save(makeRun("run-owner-2"));
    await getRunRepository().save(makeRun("run-intruder-2"));
    const terminalId = await createSession("run-owner-2");

    const crossRun = await DELETE_TERMINAL(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: "run-intruder-2", terminalId })
    });
    expect(crossRun.status).toBe(404);

    // The rightful owner can still write (the session survived) and delete it.
    const stillAlive = await POST_INPUT(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ data: "echo alive\r" }) }),
      { params: Promise.resolve({ id: "run-owner-2", terminalId }) }
    );
    expect(stillAlive.status).toBe(200);

    const ownerDelete = await DELETE_TERMINAL(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: "run-owner-2", terminalId })
    });
    expect(ownerDelete.status).toBe(200);
  }, 30_000);
});
