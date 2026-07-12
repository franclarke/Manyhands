/**
 * B-007 — safe archive/purge; no destructive CRUD delete of active runs
 * (CF-05).
 *
 * DELETE is no longer "rm the JSON": an ACTIVE run can only be cancelled;
 * removing a run from history is a logical ARCHIVE; physical PURGE is a
 * separate, journaled, idempotent operation restricted to inactive runs with
 * no live runner/processes, and the run's metadata is the LAST thing to go.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerLiveProcess, unregisterLiveProcess } from "@manyhands/execution-core";
import { planningThreadId } from "@manyhands/orchestrator-graph";
import { DELETE as DELETE_RUN } from "@/app/api/runs/[id]/route";
import { GET as GET_RUNS } from "@/app/api/runs/route";
import { archiveRun, purgeRun } from "@/lib/server/runs/archive-service";
import { JsonPlanMutationJournal } from "@/lib/server/runs/plan-mutation-journal";
import { RunLifecycleError } from "@/lib/server/runs/errors";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let runsDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-archive-"));
  runsDir = path.join(tempDir, "runs");
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = runsDir;
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(runId: string, status: RunRecord["status"], extra: Partial<RunRecord> = {}): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-sonnet",
    userPrompt: "x",
    title: "x",
    version: 0,
    status,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    patches: [],
    ...extra
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("B-007 DELETE = archive, never CRUD-delete", () => {
  it("refuses to touch an active run (409) and leaves it intact", async () => {
    const runId = "run-active-delete";
    await getRunRepository().save(makeRun(runId, "running"));

    const response = await DELETE_RUN(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: runId })
    });
    expect(response.status).toBe(409);
    const persisted = await getRunRepository().get(runId);
    expect(persisted.status).toBe("running");
    expect(persisted.archivedAt).toBeUndefined();
  });

  it("archives an inactive run: metadata survives with archivedAt and the list hides it", async () => {
    const runId = "run-archive-me";
    await getRunRepository().save(makeRun(runId, "completed"));

    const response = await DELETE_RUN(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: runId })
    });
    expect(response.status).toBe(204);

    const persisted = await getRunRepository().get(runId);
    expect(persisted.archivedAt).toBeDefined();
    expect(await exists(path.join(runsDir, `${runId}.json`))).toBe(true);

    const listDefault = await GET_RUNS(new Request("http://localhost/api/runs"));
    const bodyDefault = (await listDefault.json()) as { runs: Array<{ id?: string; runId?: string }> };
    expect(JSON.stringify(bodyDefault)).not.toContain(runId);

    const listAll = await GET_RUNS(new Request("http://localhost/api/runs?include=archived"));
    const bodyAll = (await listAll.json()) as { runs: unknown[] };
    expect(JSON.stringify(bodyAll)).toContain(runId);
  });
});

describe("B-007 purge — journaled, terminal-only, metadata last", () => {
  it("refuses to purge an active run", async () => {
    const runId = "run-purge-active";
    await getRunRepository().save(makeRun(runId, "running"));
    await expect(purgeRun(runId)).rejects.toBeInstanceOf(RunLifecycleError);
    expect(await exists(path.join(runsDir, `${runId}.json`))).toBe(true);
  });

  it("refuses to purge while a live process is registered under the run", async () => {
    const runId = "run-purge-live-proc";
    await getRunRepository().save(makeRun(runId, "interrupted"));
    const fakeChild = { pid: process.pid, kill: () => true };
    registerLiveProcess(runId, fakeChild);
    try {
      await expect(purgeRun(runId)).rejects.toThrow(/proces/i);
      expect(await exists(path.join(runsDir, `${runId}.json`))).toBe(true);
    } finally {
      unregisterLiveProcess(runId, fakeChild);
    }
  });

  it("purges every resource of a terminal run and is idempotent", async () => {
    const runId = "run-purge-happy";
    // Real side-effect residue: work copy, checkpoints (both threads), events.
    const workCopy = path.join(tempDir, "work", runId, "repo");
    await mkdir(workCopy, { recursive: true });
    await writeFile(path.join(workCopy, "file.txt"), "x", "utf8");
    const execThread = path.join(runsDir, "checkpoints", runId);
    const planThread = path.join(runsDir, "checkpoints", planningThreadId(runId));
    await mkdir(execThread, { recursive: true });
    await mkdir(planThread, { recursive: true });
    await writeFile(path.join(execThread, "latest.json"), "{}", "utf8");
    await writeFile(path.join(planThread, "latest.json"), "{}", "utf8");
    await mkdir(runsDir, { recursive: true });
    await writeFile(path.join(runsDir, `${runId}.events.jsonl`), "{}\n", "utf8");
    await mkdir(path.join(runsDir, "attempts"), { recursive: true });
    await writeFile(path.join(runsDir, "attempts", `${runId}.json`), "{\"version\":1,\"attempts\":[]}", "utf8");
    const planMutations = new JsonPlanMutationJournal({ directory: path.join(runsDir, "plan-mutations") });
    await planMutations.reserve({
      operationId: `${runId}:mutation`, runId, kind: "replan", expectedRunVersion: 0,
      sourcePlanRevision: 1, targetPlanRevision: 2, graphHash: "run-graph"
    });
    await planMutations.reserve({
      operationId: "other-run:mutation", runId: "other-run", kind: "replan", expectedRunVersion: 0,
      sourcePlanRevision: 1, targetPlanRevision: 2, graphHash: "other-graph"
    });

    await getRunRepository().save(
      makeRun(runId, "completed", {
        provisioned: {
          repoRoot: workCopy,
          baseBranch: "main",
          baseCommit: "abc",
          provisionedAt: "2026-07-12T00:00:00.000Z"
        }
      })
    );

    const report = await purgeRun(runId, { workCopyRoot: path.join(tempDir, "work") });
    expect(report.alreadyPurged).toBe(false);

    expect(await exists(workCopy)).toBe(false);
    expect(await exists(execThread)).toBe(false);
    expect(await exists(planThread)).toBe(false);
    expect(await exists(path.join(runsDir, `${runId}.events.jsonl`))).toBe(false);
    expect(await exists(path.join(runsDir, "attempts", `${runId}.json`))).toBe(false);
    expect(await planMutations.pending(runId)).toEqual([]);
    expect((await planMutations.pending("other-run")).map((operation) => operation.operationId)).toEqual(["other-run:mutation"]);
    expect(await exists(path.join(runsDir, `${runId}.json`))).toBe(false);
    expect(await exists(path.join(runsDir, `${runId}.purge.json`))).toBe(false);

    const again = await purgeRun(runId, { workCopyRoot: path.join(tempDir, "work") });
    expect(again.alreadyPurged).toBe(true);
  });

  it("never deletes the work copy when it lives outside the managed work root (legacy source repo)", async () => {
    const runId = "run-purge-legacy";
    const sourceLike = path.join(tempDir, "user-repo");
    await mkdir(sourceLike, { recursive: true });
    await writeFile(path.join(sourceLike, "precious.txt"), "keep me", "utf8");
    await getRunRepository().save(
      makeRun(runId, "failed", {
        provisioned: {
          repoRoot: sourceLike,
          baseBranch: "main",
          baseCommit: "abc",
          provisionedAt: "2026-07-12T00:00:00.000Z"
        }
      })
    );

    await purgeRun(runId, { workCopyRoot: path.join(tempDir, "work") });
    expect(await exists(path.join(sourceLike, "precious.txt"))).toBe(true);
    expect(await exists(path.join(runsDir, `${runId}.json`))).toBe(false);
  });

  it("a crash mid-purge keeps the metadata and the journal; the retry completes and converges", async () => {
    const runId = "run-purge-crash";
    const workCopy = path.join(tempDir, "work", runId, "repo");
    await mkdir(workCopy, { recursive: true });
    await getRunRepository().save(
      makeRun(runId, "completed", {
        provisioned: {
          repoRoot: workCopy,
          baseBranch: "main",
          baseCommit: "abc",
          provisionedAt: "2026-07-12T00:00:00.000Z"
        }
      })
    );

    let failNext = true;
    await expect(
      purgeRun(runId, {
        workCopyRoot: path.join(tempDir, "work"),
        removeResource: async (target) => {
          if (failNext) {
            failNext = false;
            throw new Error("simulated crash (disk hiccup)");
          }
          await rm(target, { recursive: true, force: true });
        }
      })
    ).rejects.toThrow(/simulated crash/);

    // Metadata survives the partial purge; the journal records the attempt.
    expect(await exists(path.join(runsDir, `${runId}.json`))).toBe(true);
    expect(await exists(path.join(runsDir, `${runId}.purge.json`))).toBe(true);
    const journal = JSON.parse(await readFile(path.join(runsDir, `${runId}.purge.json`), "utf8")) as {
      runId: string;
    };
    expect(journal.runId).toBe(runId);

    // Retry finishes the job.
    const retry = await purgeRun(runId, { workCopyRoot: path.join(tempDir, "work") });
    expect(retry.alreadyPurged).toBe(false);
    expect(await exists(path.join(runsDir, `${runId}.json`))).toBe(false);
    expect(await exists(path.join(runsDir, `${runId}.purge.json`))).toBe(false);
    expect(await exists(workCopy)).toBe(false);
  });
});
