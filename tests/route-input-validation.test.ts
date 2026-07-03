/**
 * API input-validation hardening (F-024, F-025).
 *
 * Both validations run BEFORE any repository access, so a malformed request must
 * be rejected with 400 without a persisted run. A valid-but-missing run falls
 * through to a not-found (≠ 400), which guards the rules against over-rejection.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_FORK } from "@/app/api/runs/[id]/fork/route";
import { POST as POST_ANSWER } from "@/app/api/runs/[id]/answer/route";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-routeval-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  // Drain fire-and-forget pipeline kicks BEFORE restoring the runs dir so no
  // late write leaks into the real .manyhands/runs.
  await drainAllRunBackgroundTasksForTests();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function postFork(id: string, body: unknown): Promise<Response> {
  return POST_FORK(new Request("http://mh.test", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id })
  });
}

function postAnswer(id: string, body: unknown): Promise<Response> {
  return POST_ANSWER(new Request("http://mh.test", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id })
  });
}

describe("fork checkpointId validation (F-025 — path traversal / authz bypass)", () => {
  it("rejects a path-traversal checkpointId with 400", async () => {
    expect((await postFork("run-x", { checkpointId: "../../../etc/passwd" })).status).toBe(400);
  });

  it("rejects checkpointIds containing slashes, backslashes, or dots", async () => {
    expect((await postFork("run-x", { checkpointId: "a/b" })).status).toBe(400);
    expect((await postFork("run-x", { checkpointId: "..\\..\\x" })).status).toBe(400);
    expect((await postFork("run-x", { checkpointId: "a.b" })).status).toBe(400);
  });

  it("accepts a well-formed UUID checkpointId (falls through past validation, not a 400)", async () => {
    const res = await postFork("run-x", { checkpointId: "1f16e88b-773e-6730-ffff-d2290b305a37" });
    expect(res.status).not.toBe(400);
  });
});

describe("answer length validation (F-024 — unbounded answer)", () => {
  it("rejects an oversized answer with 400", async () => {
    const huge = "x".repeat(50_000);
    expect((await postAnswer("run-x", { nodeId: "n1", answer: huge })).status).toBe(400);
  });

  it("does not reject a normal-length answer at validation (not a 400)", async () => {
    const res = await postAnswer("run-x", { nodeId: "n1", answer: "Reintentar reparación" });
    expect(res.status).not.toBe(400);
  });
});
