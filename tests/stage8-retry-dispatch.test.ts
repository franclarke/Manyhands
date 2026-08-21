import { createHash } from "node:crypto";

import type { DigestHasher } from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  foldRun,
  type Decision,
  type ProductRunDefinition,
  type RunCommandPayload,
  type RunEvent,
  type RunProjection
} from "@manyhands/run-coordinator";
import { describe, expect, it } from "vitest";

import { createProductRunApplication } from "../apps/daemon/src/product-run-application.js";

const at = "2026-08-14T12:00:00.000Z";
const runId = "run:stage8:retry-dispatch";
const daemonEpoch = "daemon:stage8:retry-dispatch";
const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("Stage 8 recovery decision dispatch", () => {
  it("starts a fresh execution effect after resolving a failed attempt with retry", async () => {
    const spawnedAttempts: string[] = [];
    const application = createProductRunApplication({
      hasher: sha256,
      clock: () => at,
      executionProcess: (_definition, execution) => {
        if (execution === undefined) throw new Error("Missing execution identity.");
        spawnedAttempts.push(execution.attemptId);
        return { executable: process.execPath, argv: ["-e", ""], cwd: process.cwd(), env: {} };
      }
    });
    const initial = await application.decide(
      command("start", 1, { type: "start_run" }),
      context(projection("running"))
    );
    const prior = initial.effects[0];
    if (prior === undefined) throw new Error("Missing initial execution effect.");

    const retrying: RunProjection = {
      ...projection("waiting_for_input"),
      effectIntents: { [prior.intent.effectId]: prior.intent },
      effectTerminals: {
        [prior.intent.effectId]: { status: "completed", receiptId: "receipt:failed-execution" }
      },
      decisions: { [retryDecision.id]: retryDecision }
    };
    const retried = await application.decide(
      command("retry", 2, {
        type: "resolve_decision",
        decisionId: retryDecision.id,
        optionId: "retry"
      }),
      context(retrying)
    );

    const recovery = retried.effects[0];
    if (recovery === undefined) throw new Error("Retry did not dispatch a fresh execution effect.");
    expect(retried.effects).toHaveLength(1);
    expect(recovery.intent.attemptId).toBe("stage3:execution:recovery:1");
    expect(recovery.intent.effectId).not.toBe(prior.intent.effectId);
    expect(spawnedAttempts).toEqual(["stage3:execution", "stage3:execution:recovery:1"]);
  });

  it("extends a timed-out leaf retry to the bounded recovery timeout", async () => {
    const observedTimeouts: unknown[] = [];
    const application = createProductRunApplication({
      hasher: sha256,
      clock: () => at,
      executionProcess: (definition) => {
        observedTimeouts.push(definition.executionConfig.leafTimeoutMs);
        return { executable: process.execPath, argv: ["-e", ""], cwd: process.cwd(), env: {} };
      }
    });
    const timedOut: RunProjection = {
      ...projection("waiting_for_input"),
      attempts: {
        "attempt:stage8:timeout": {
          attemptId: "attempt:stage8:timeout",
          nodeId: "node:stage8",
          inputFingerprint: "sha256:timeout",
          kind: "execution",
          status: "failed",
          repairPasses: 0,
          failureReason: "timeout: The agent hit the hard timeout."
        }
      },
      decisions: { [timeoutRetryDecision.id]: timeoutRetryDecision }
    };

    await application.decide(command("timeout-retry", 2, {
      type: "resolve_decision",
      decisionId: timeoutRetryDecision.id,
      optionId: "retry"
    }), context(timedOut));

    expect(observedTimeouts).toEqual([1_800_000]);
  });

  it("recovers only the durably identified daemon-loss interruption", async () => {
    const application = createProductRunApplication({
      hasher: sha256,
      clock: () => at,
      recoverInterruptedExecutionReason: "reconcile_interrupted_process_spawn",
      executionProcess: () => ({ executable: process.execPath, argv: ["-e", ""], cwd: process.cwd(), env: {} })
    });
    const initial = await application.decide(
      command("restart-start", 1, { type: "start_run" }),
      context(projection("running"))
    );
    const prior = initial.effects[0];
    if (prior === undefined) throw new Error("Missing initial execution effect.");
    const running: RunProjection = {
      ...projection("running"),
      effectIntents: { [prior.intent.effectId]: prior.intent }
    };
    const recovered = await application.react({
      intent: prior.intent,
      receipts: [],
      terminal: {
        eventId: "effect:reconciled",
        occurredAt: at,
        type: "effect.failed",
        payload: {
          effectId: prior.intent.effectId,
          receiptId: "receipt:reconciled",
          reason: "reconcile_interrupted_process_spawn"
        }
      }
    }, context(running));

    expect(recovered.domainEvents).toEqual([]);
    expect(recovered.effects).toEqual([
      expect.objectContaining({ intent: expect.objectContaining({ attemptId: "stage3:execution:recovery:1" }) })
    ]);

    const timedOut = await application.react({
      intent: prior.intent,
      receipts: [],
      terminal: {
        eventId: "effect:timeout",
        occurredAt: at,
        type: "effect.failed",
        payload: {
          effectId: prior.intent.effectId,
          receiptId: "receipt:timeout",
          reason: "timeout"
        }
      }
    }, context(running));

    expect(timedOut.effects).toEqual([]);
    expect(timedOut.domainEvents).toEqual([
      expect.objectContaining({ type: "run.failed" })
    ]);
  });
});

const retryDecision: Decision = {
  id: "decision:stage8:retry",
  kind: "resolve_conflict",
  question: "Repair the unavailable sandbox and retry the failed attempt?",
  options: [{ id: "retry", label: "Retry" }, { id: "stop", label: "Stop" }],
  affectedNodeIds: ["node:stage8"],
  evidenceRefs: ["attempt:stage8:failed"],
  impact: "behavior",
  status: "pending"
};

const timeoutRetryDecision: Decision = {
  ...retryDecision,
  id: "decision:stage8:timeout-retry",
  question: "Retry after the artifact materialization failure."
};

function projection(lifecycle: RunProjection["lifecycle"]): RunProjection {
  return { ...foldRun([created()]), lifecycle };
}

function created(): RunEvent {
  return {
    eventId: "run:stage8:retry-dispatch:created",
    runId,
    sequence: 1,
    occurredAt: at,
    type: "run.created",
    payload: { goal: "Dispatch recovery execution", definition: definition() }
  };
}

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage8",
    userPrompt: "Retry the failed execution with repaired sandbox evidence.",
    acceptanceCriteria: ["The retry has a fresh execution identity."],
    title: "Stage 8 recovery dispatch",
    planningSelection: { executorId: "codex-cli", model: "gpt-test" },
    executionSelection: { executorId: "codex-cli", model: "gpt-test" },
    repairSelection: { executorId: "codex-cli", model: "gpt-test" },
    executionConfig: { leafTimeoutMs: 600_000 },
    targetContext: {
      fingerprint: "target:stage8",
      sourceBaseCommit: "base:stage8",
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

function command(commandId: string, expectedRevision: number, payload: RunCommandPayload) {
  return buildRunCommandEnvelope({
    commandId: `stage8-retry:${commandId}`,
    runId,
    expectedRevision,
    submittedAt: at,
    command: payload
  }, sha256);
}
