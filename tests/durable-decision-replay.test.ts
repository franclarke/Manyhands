import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { durableResolutionForGate } from "@/lib/server/runs/execution-pipeline";
import { appendRunEventsRequired } from "@/lib/server/runs/run-model-event-log";

describe("durable execution decision replay", () => {
  let directory: string;
  const previousRunsDir = process.env.MANYHANDS_RUNS_DIR;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "manyhands-decision-replay-"));
    process.env.MANYHANDS_RUNS_DIR = directory;
  });

  afterEach(async () => {
    if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
    else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
    await rm(directory, { recursive: true, force: true });
  });

  it("re-applies a resolved answer only to the suspension checkpoint that raised it", async () => {
    const runId = "run-replay";
    await appendRunEventsRequired(runId, [
      {
        actor: "system",
        type: "decision.raised",
        payload: {
          decisionId: "clarify:task-a",
          kind: "clarify",
          blocking: true,
          context: {
            nodeIds: ["task-a"],
            gate: "leaf_validation_failed",
            checkpointId: "checkpoint-before-resume"
          }
        }
      },
      {
        actor: "human",
        type: "decision.resolved",
        payload: {
          decisionId: "clarify:task-a",
          choice: { answer: "retry_repair" },
          actor: "human"
        }
      }
    ]);

    const gate = {
      gate: "leaf_validation_failed" as const,
      gateId: "leaf_validation_failed:task-a:one",
      taskId: "task-a",
      validationOutput: "tests failed"
    };
    await expect(
      durableResolutionForGate(runId, gate, "checkpoint-before-resume")
    ).resolves.toMatchObject({ kind: "resume", decision: { action: "retry_repair" } });
    await expect(
      durableResolutionForGate(runId, gate, "checkpoint-after-resume")
    ).resolves.toBeUndefined();
  });

  it("recovers a durable replan choice without converting it into an invalid graph resume", async () => {
    const runId = "run-replan-replay";
    await appendRunEventsRequired(runId, [
      {
        actor: "system",
        type: "decision.raised",
        payload: {
          decisionId: "clarify:task-b",
          kind: "clarify",
          blocking: true,
          context: {
            nodeIds: ["task-b"],
            gate: "leaf_validation_failed",
            checkpointId: "checkpoint-b"
          }
        }
      },
      {
        actor: "human",
        type: "decision.resolved",
        payload: {
          decisionId: "clarify:task-b",
          choice: { answer: "replan_subtree" },
          actor: "human"
        }
      }
    ]);

    await expect(
      durableResolutionForGate(
        runId,
        { gate: "leaf_validation_failed", taskId: "task-b", validationOutput: "failed" },
        "checkpoint-b"
      )
    ).resolves.toMatchObject({ kind: "replan" });
  });
});
