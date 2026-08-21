import { createHash } from "node:crypto";

import type { DigestHasher } from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  foldRun,
  type ProductRunDefinition,
  type RunCommandPayload,
  type RunEvent,
  type RunProjection
} from "@manyhands/run-coordinator";
import { describe, expect, it } from "vitest";

import { createProductRunApplication } from "../apps/daemon/src/product-run-application.js";

const at = "2026-08-13T13:00:00.000Z";
const runId = "run:stage3:attempt-identity";
const daemonEpoch = "daemon:stage3:attempt-identity";
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("Stage 3 resumed execution identity", () => {
  for (const scenario of [
    { command: "resume_run" as const, lifecycle: "paused" as const },
    { command: "restart_run" as const, lifecycle: "interrupted" as const },
    { command: "restart_run" as const, lifecycle: "failed" as const }
  ]) {
    it(`${scenario.command} cannot reuse a prior execution effect or sidecar`, async () => {
      const spawnedAttempts: string[] = [];
      const adoptedAttempts: string[] = [];
      const application = createProductRunApplication({
        hasher: sha256,
        clock: () => at,
        executionProcess: (_definition, context) => {
          if (context === undefined) throw new Error("Missing execution identity.");
          spawnedAttempts.push(context.attemptId);
          return {
            executable: process.execPath,
            argv: ["-e", ""],
            cwd: process.cwd(),
            env: {}
          };
        },
        loadExecutionResult: async (loadedRunId, attemptId) => {
          expect(loadedRunId).toBe(runId);
          adoptedAttempts.push(attemptId);
          return [];
        }
      });
      const running = projection("running");
      const first = await application.decide(
        command("command:start", 1, { type: "start_run" }),
        context(running)
      );
      const prior = first.effects[0];
      if (prior === undefined) throw new Error("Missing initial execution effect.");
      const resumedProjection: RunProjection = {
        ...projection(scenario.lifecycle),
        effectIntents: { [prior.intent.effectId]: prior.intent },
        effectTerminals: {
          [prior.intent.effectId]: {
            status: "completed",
            receiptId: "receipt:prior-execution"
          }
        },
        ...(scenario.lifecycle === "paused"
          ? { lifecycleBeforePause: "running" as const }
          : {})
      };

      const resumed = await application.decide(
        command(`command:${scenario.command}`, 2, {
          type: scenario.command,
          reason: "continue with fresh execution evidence"
        }),
        context(resumedProjection)
      );
      const next = resumed.effects[0];
      if (next === undefined) throw new Error("Missing resumed execution effect.");

      expect(prior.intent.attemptId).toBe("stage3:execution");
      expect(next.intent.attemptId).toBe("stage3:execution:recovery:1");
      expect(next.intent.effectId).not.toBe(prior.intent.effectId);
      expect(spawnedAttempts).toEqual([
        "stage3:execution",
        "stage3:execution:recovery:1"
      ]);

      await application.react({
        intent: next.intent,
        receipts: [],
        terminal: {
          eventId: "effect:resumed:completed",
          occurredAt: at,
          type: "effect.completed",
          payload: {
            effectId: next.intent.effectId,
            receiptId: "receipt:resumed-execution"
          }
        }
      }, {
        runId,
        daemonEpoch,
        currentRevision: 3,
        events: [],
        projection: {
          ...running,
          effectIntents: {
            [prior.intent.effectId]: prior.intent,
            [next.intent.effectId]: next.intent
          }
        }
      });

      expect(adoptedAttempts).toEqual(["stage3:execution:recovery:1"]);
    });
  }
});

function projection(lifecycle: RunProjection["lifecycle"]): RunProjection {
  return { ...foldRun([created()]), lifecycle };
}

function created(): RunEvent {
  return {
    eventId: "run:stage3:attempt-identity:created",
    runId,
    sequence: 1,
    occurredAt: at,
    type: "run.created",
    payload: {
      goal: "Prove fresh execution identity",
      definition: definition()
    }
  };
}

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage3",
    userPrompt: "Prove fresh execution identity",
    acceptanceCriteria: ["Resumed work uses fresh physical evidence"],
    title: "Fresh attempt identity",
    planningSelection: { executorId: "codex-cli", model: "gpt-test" },
    executionSelection: { executorId: "codex-cli", model: "gpt-test" },
    repairSelection: { executorId: "codex-cli", model: "gpt-test" },
    executionConfig: {},
    targetContext: {
      fingerprint: "target:stage3",
      sourceBaseCommit: "base:stage3",
      sourceBranch: "main",
      sourceRealPath: process.cwd()
    }
  };
}

function context(projection: RunProjection) {
  return {
    runId,
    daemonEpoch,
    currentRevision: projection.sequence,
    acceptedRevision: projection.sequence + 1,
    events: [] as RunEvent[],
    projection
  };
}

function command(
  commandId: string,
  expectedRevision: number,
  payload: RunCommandPayload
) {
  return buildRunCommandEnvelope({
    commandId,
    runId,
    expectedRevision,
    submittedAt: at,
    command: payload
  }, sha256);
}
