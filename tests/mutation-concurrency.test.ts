/**
 * INV-4 — idempotent HITL mutations.
 *
 * `claimRunMutation` re-checks its expectation against the FRESH record inside
 * the per-run write lock and the mutator consumes the claim, so of N identical
 * concurrent decisions exactly one wins and the rest get a deterministic
 * RunMutationConflictError (409). These tests drive the real JsonRunRecordStore
 * on a temp directory — no fakes between the claim and the disk.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunMutationConflictError } from "@/lib/server/runs/errors";
import { claimRunMutation } from "@/lib/server/runs/mutation-guard";
import { persistLivePlanningNodes } from "@/lib/server/runs/planning-host";
import { markRunnerActive, markRunnerInactive } from "@/lib/server/runs/runner-state";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-mutation-"));
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_RUNS_DIR;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "created",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    patches: [],
    ...overrides
  };
}

function gatePausedRun(gateId = "leaf_validation_failed:task-1:abc12345"): RunRecord {
  return makeRun({
    status: "paused",
    pausedDuring: "running",
    pendingDecision: { gate: "leaf_validation_failed", gateId, taskId: "task-1" },
    pendingQuestion: { nodeId: "task-1", question: "¿Cómo continuar?", options: ["Reintentar", "Abortar"] }
  });
}

function consumeGate(current: RunRecord): RunRecord {
  const next = { ...current, status: "running" as const };
  delete next.pausedDuring;
  delete next.pendingDecision;
  delete next.pendingQuestion;
  return next;
}

describe("repository version counter", () => {
  it("bumps monotonically on save and update, ignoring stale snapshots", async () => {
    const repo = getRunRepository();
    const first = await repo.save(makeRun());
    expect(first.version).toBe(1);
    const second = await repo.save({ ...first, status: "generating" });
    expect(second.version).toBe(2);
    // A writer holding a STALE snapshot (version 1) cannot regress the counter.
    const third = await repo.save({ ...first, status: "needs_review" });
    expect(third.version).toBe(3);
    const fourth = await repo.update("run-1", (current) => ({ ...current, heartbeatAt: "2026-06-11T00:01:00.000Z" }));
    expect(fourth.version).toBe(4);
  });

  it("live planning node updates preserve concurrently written planning data", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun());

    await Promise.all([
      persistLivePlanningNodes(
        "run-1",
        new Map([
          [
            "node-a",
            {
              id: "node-a",
              parentId: null,
              title: "Node A",
              depth: 0,
              state: "active"
            }
          ]
        ])
      ),
      repo.update("run-1", (current) => ({
        ...current,
        planning: { decomposition: { graph: { rootId: "root", nodes: {}, dependencies: [] } } }
      }))
    ]);

    const final = await repo.get("run-1");
    expect(final.livePlanningNodes?.map((node) => node.id)).toEqual(["node-a"]);
    expect((final.planning as { decomposition: { graph: { rootId: string } } }).decomposition.graph.rootId).toBe("root");
  });
});

describe("claimRunMutation", () => {
  it("applies the mutation when the expectation holds", async () => {
    await getRunRepository().save(gatePausedRun());
    const claimed = await claimRunMutation(
      "run-1",
      { status: ["paused"], pausedDuring: "running", pendingDecisionGateId: "any" },
      consumeGate
    );
    expect(claimed.status).toBe("running");
    expect(claimed.pendingDecision).toBeUndefined();
  });

  it("rejects a stale status with the current state attached", async () => {
    await getRunRepository().save(makeRun({ status: "running" }));
    const error = await claimRunMutation("run-1", { status: ["paused"] }, (c) => c).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunMutationConflictError);
    expect((error as RunMutationConflictError).currentStatus).toBe("running");
    expect((error as RunMutationConflictError).currentVersion).toBe(1);
  });

  it("rejects when the gate was already resolved", async () => {
    await getRunRepository().save(makeRun({ status: "paused", pausedDuring: "running" }));
    await expect(
      claimRunMutation("run-1", { pendingDecisionGateId: "any" }, (c) => c)
    ).rejects.toBeInstanceOf(RunMutationConflictError);
  });

  it("rejects a gateId aimed at a different (re-minted) suspension", async () => {
    await getRunRepository().save(gatePausedRun("leaf_validation_failed:task-1:fresh001"));
    await expect(
      claimRunMutation("run-1", { pendingDecisionGateId: "leaf_validation_failed:task-1:stale999" }, consumeGate)
    ).rejects.toBeInstanceOf(RunMutationConflictError);
    // Legacy pause without gateId: a pinned claim is accepted (state checks still hold).
    await getRunRepository().update("run-1", (current) => ({
      ...current,
      pendingDecision: { gate: "leaf_validation_failed" as const, taskId: "task-1" }
    }));
    const claimed = await claimRunMutation(
      "run-1",
      { pendingDecisionGateId: "leaf_validation_failed:task-1:whatever" },
      consumeGate
    );
    expect(claimed.pendingDecision).toBeUndefined();
  });

  it("rejects a mismatched question node and a stale version", async () => {
    await getRunRepository().save(
      makeRun({
        status: "paused",
        pausedDuring: "generating",
        pendingQuestion: { nodeId: "node-7", question: "¿REST o GraphQL?", options: ["REST", "GraphQL"] }
      })
    );
    await expect(
      claimRunMutation("run-1", { pendingQuestionNodeId: "node-other" }, (c) => c)
    ).rejects.toBeInstanceOf(RunMutationConflictError);
    await expect(claimRunMutation("run-1", { version: 99 }, (c) => c)).rejects.toBeInstanceOf(
      RunMutationConflictError
    );
    // Matching node and version pass.
    const claimed = await claimRunMutation("run-1", { pendingQuestionNodeId: "node-7", version: 1 }, (c) => c);
    expect(claimed.version).toBe(2);
  });

  it("rejects while an in-process runner is driving the run", async () => {
    await getRunRepository().save(makeRun({ status: "interrupted" }));
    markRunnerActive("run-1");
    try {
      await expect(
        claimRunMutation("run-1", { status: ["interrupted"], rejectActiveRunner: true }, (c) => c)
      ).rejects.toBeInstanceOf(RunMutationConflictError);
    } finally {
      markRunnerInactive("run-1");
    }
    await expect(
      claimRunMutation("run-1", { status: ["interrupted"], rejectActiveRunner: true }, (c) => c)
    ).resolves.toBeDefined();
  });

  it("INV-4: of N concurrent identical gate decisions exactly one wins", async () => {
    await getRunRepository().save(gatePausedRun());
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        claimRunMutation(
          "run-1",
          { status: ["paused"], pausedDuring: "running", pendingDecisionGateId: "any" },
          consumeGate
        )
      )
    );
    const winners = attempts.filter((a) => a.status === "fulfilled");
    const losers = attempts.filter(
      (a): a is PromiseRejectedResult => a.status === "rejected"
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const loser of losers) {
      expect(loser.reason).toBeInstanceOf(RunMutationConflictError);
    }
    const final = await getRunRepository().get("run-1");
    expect(final.status).toBe("running");
    expect(final.pendingDecision).toBeUndefined();
  });

  it("INV-4: concurrent restart-style claims consume the restartable status once", async () => {
    await getRunRepository().save(makeRun({ status: "failed", failedDuring: "running" }));
    const attempts = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        claimRunMutation("run-1", { status: ["interrupted", "failed"] }, (current) => ({
          ...current,
          status: "approved" as const,
          errorMessage: undefined,
          failedDuring: undefined
        }))
      )
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect((await getRunRepository().get("run-1")).status).toBe("approved");
  });
});
