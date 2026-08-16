import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DigestHasher } from "@manyhands/contracts";
import { DeliveryRecoveryError } from "@manyhands/execution-core";
import {
  foldRun,
  type RunEvent,
  type RunEventInput,
  type RunProjection
} from "@manyhands/run-coordinator";
import type { RunActorReactionContext } from "@manyhands/run-engine";
import { JsonlRunEventStore } from "@manyhands/run-store";

import { createProductRunApplication } from "../apps/daemon/src/product-run-application.js";
import {
  FileTransitionalLifecycleResultStore,
  createTransitionalUnsafeProfile
} from "../apps/daemon/src/transitional-unsafe-profile.js";

import { recoveryDiagnosticView } from "@/lib/run-model/presentation";

const at = "2026-08-16T00:00:00.000Z";
const runId = "run:stage11-diagnostic";
const daemonEpoch = "epoch-stage11-diagnostic";
const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const DIVERGENCE = {
  kind: "target_divergence",
  ref: "refs/heads/main",
  expectedOid: "00273f0aa1",
  actualOid: "9f31c4d7be"
} as const;

/**
 * Stage 10 gave recovery failures a structured diagnostic carrying the ref and
 * both OIDs, precisely because "the delivery target changed" cannot distinguish
 * a branch that advanced to an ancestor of the candidate from one that moved to
 * an unrelated commit — two situations with different answers.
 *
 * It then got flattened into `Error.message` at the adapter boundary and reached
 * the operator as a red sentence. The evidence exists; the path from where it is
 * produced to where it is read is what was missing.
 */
describe("A refused publication", () => {
  it("records the diagnostic beside the failed observation", async () => {
    const stateRoot = await temporaryDirectory();
    await seedDeliveringRun(stateRoot);
    const results = new FileTransitionalLifecycleResultStore(path.join(stateRoot, "results"));
    const recorded: Array<{ observation: string; reason?: string }> = [];

    const profile = createTransitionalUnsafeProfile({
      stateRoot,
      nodeExecutable: process.execPath,
      workerScriptPath: path.join(stateRoot, "worker.js"),
      cwd: stateRoot,
      resultStore: results,
      planner: { plan: async () => { throw new Error("unused"); } },
      delivery: { publish: async () => { throw new DeliveryRecoveryError({ ...DIVERGENCE }); } }
    });
    const adapter = profile.adapters.find(({ kind }) => kind === "delivery");

    await adapter?.execute(deliveryIntent() as never, {
      observerDaemonEpoch: daemonEpoch,
      inputSpec: { payload: {} } as never,
      priorReceipts: [],
      record: async (observation: { observation: string; reason?: string }) => {
        recorded.push(observation);
        return {} as never;
      }
    } as never);

    expect(recorded[0]?.observation).toBe("failed");
    // The prose still says it, because an operator reading only the message has
    // to learn the same thing.
    expect(recorded[0]?.reason).toContain("9f31c4d7be");
    expect(await results.readRecoveryDiagnostic(deliveryIntent().effectId)).toEqual(DIVERGENCE);
  });

  it("attaches the diagnostic to the failure the run records", async () => {
    const application = createProductRunApplication({
      hasher: sha256,
      clock: () => at,
      executionProcess: () => ({ executable: process.execPath, argv: [], cwd: process.cwd(), env: {} }),
      loadRecoveryDiagnostic: async () => ({ ...DIVERGENCE })
    });

    const reaction = await application.react({
      intent: deliveryIntent(),
      receipts: [],
      terminal: {
        eventId: "effect:delivery:failed",
        occurredAt: at,
        type: "effect.failed",
        payload: { effectId: deliveryIntent().effectId, reason: "refused" }
      }
    } as never, {
      runId,
      daemonEpoch,
      currentRevision: 1,
      events: [] as RunEvent[],
      projection: { sequence: 1, deliveryApproval: approval() } as RunProjection
    } as RunActorReactionContext);

    const failure = reaction.domainEvents[0] as RunEventInput & {
      payload: { diagnostic?: typeof DIVERGENCE };
    };
    expect(failure.type).toBe("delivery.failed");
    expect(failure.payload.diagnostic).toEqual(DIVERGENCE);
  });

  it("keeps the diagnostic on the projection the workspace reads", async () => {
    const stateRoot = await temporaryDirectory();
    const events = await seedDeliveringRun(stateRoot);
    const projection = foldRun([...events, {
      eventId: `${runId}:delivery.failed`,
      runId,
      sequence: events.length + 1,
      occurredAt: at,
      type: "delivery.failed",
      payload: {
        manifestId: "manifest-diagnostic",
        reason: "Ref refs/heads/main was expected at 00273f0aa1 and holds 9f31c4d7be; nothing was published.",
        retryable: true,
        diagnostic: { ...DIVERGENCE }
      }
    } as RunEvent]);

    expect(projection.recoveryDiagnostic).toEqual(DIVERGENCE);
  });
});

describe("What the workspace shows for a refused publication", () => {
  it("names the ref and both commits instead of saying the target changed", () => {
    expect(recoveryDiagnosticView({ recoveryDiagnostic: { ...DIVERGENCE } })).toEqual({
      headline: "La rama objetivo se movió; no se publicó nada.",
      evidence: [
        { label: "Referencia", value: "refs/heads/main" },
        { label: "Se esperaba", value: "00273f0aa1" },
        { label: "Contiene", value: "9f31c4d7be" }
      ]
    });
  });

  it("names the evidence each other diagnostic carries", () => {
    expect(recoveryDiagnosticView({
      recoveryDiagnostic: {
        kind: "stale_decision",
        decisionId: "approve-plan",
        raisedAtGraphRevision: 1,
        currentGraphRevision: 2
      }
    })?.evidence).toEqual([
      { label: "Decisión", value: "approve-plan" },
      { label: "Planteada en revisión", value: "1" },
      { label: "Revisión actual", value: "2" }
    ]);
  });

  it("shows nothing when the run recorded no diagnostic", () => {
    // A journal written before diagnostics travelled structured carries only
    // its sentence, which the failure block already renders. Inventing
    // labelled fields by parsing that sentence would be reading tea leaves.
    expect(recoveryDiagnosticView({})).toBeNull();
    expect(recoveryDiagnosticView({ recoveryDiagnostic: undefined })).toBeNull();
  });
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  ));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage11-diagnostic-"));
  temporaryDirectories.push(directory);
  return directory;
}

function deliveryIntent() {
  return {
    runId,
    attemptId: "stage3:delivery" as const,
    kind: "delivery" as const,
    inputDigest: `sha256:${"a".repeat(64)}`,
    daemonEpoch,
    idempotency: "reconcile_then_repeat" as const,
    requestedAt: at,
    effectId: `sha256:${"b".repeat(64)}`
  };
}

function approval() {
  return {
    manifestId: "manifest-diagnostic",
    finalSha: "candidate-diagnostic",
    targetBranch: "main",
    targetHead: "base-diagnostic",
    targetFingerprint: "target:diagnostic",
    actor: "operator",
    idempotencyKey: "delivery-diagnostic"
  };
}

function definition() {
  return {
    schemaVersion: 1 as const,
    workspaceId: "workspace:diagnostic",
    userPrompt: "Exercise the recovery diagnostic path",
    acceptanceCriteria: ["a refused publication is legible"],
    title: "Stage 11 recovery diagnostic",
    planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
    repairSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionConfig: {},
    targetContext: {
      fingerprint: "target:diagnostic",
      sourceBaseCommit: "base-diagnostic",
      sourceBranch: "main",
      sourceRealPath: process.cwd()
    }
  };
}

async function seedDeliveringRun(stateRoot: string): Promise<RunEvent[]> {
  const store = new JsonlRunEventStore({ directory: path.join(stateRoot, "runs") });
  const authority = await store.claimAuthority(runId, "stage11-diagnostic");
  const inputs: RunEventInput[] = [
    { eventId: `${runId}:created`, occurredAt: at, type: "run.created", payload: { goal: definition().userPrompt, definition: definition() } },
    input("graph.revision.proposed", { graphId: "graph-diagnostic", revision: 1 }),
    input("graph.revision.approved", { graphId: "graph-diagnostic", revision: 1 }),
    input("evidence.matrix_recorded", { matrix: verifiedMatrix() }),
    input("final_candidate.verified", {
      manifestId: "manifest-diagnostic",
      commit: "candidate-diagnostic",
      evidenceMatrixId: "matrix-diagnostic",
      evidenceEligible: true,
      executionSucceeded: true,
      sourceTargetFingerprint: "target:diagnostic",
      targetBranch: "main",
      targetHead: "base-diagnostic",
      finalManifest: {
        commitSha: "candidate-diagnostic",
        treeSha: "tree-diagnostic",
        graphRevision: 1,
        artifactIds: ["artifact-diagnostic"],
        evidenceMatrixId: "matrix-diagnostic",
        validationRecipeDigest: "sha256:recipe-diagnostic",
        deliveryTarget: "main"
      }
    }),
    input("delivery.started", { approval: approval() })
  ];
  await store.bind(authority).append(runId, 0, inputs);
  return inputs.map((event, index) => ({ ...event, runId, sequence: index + 1 }) as RunEvent);
}

function verifiedMatrix() {
  return {
    matrixId: "matrix-diagnostic",
    candidateCommit: "candidate-diagnostic",
    validationContract: { id: "validation-diagnostic", revision: "revision-1" },
    criteria: [{
      criterionId: "criterion-diagnostic",
      obligationId: "obligation-diagnostic",
      status: "satisfied" as const,
      justification: "The validator checked the exact candidate.",
      evidenceRefs: ["evidence-diagnostic"]
    }],
    outcome: "verified" as const,
    validationRecipeDigest: "sha256:recipe-diagnostic",
    evidenceBindings: [],
    observations: []
  };
}

function input(type: string, payload: Record<string, unknown>): RunEventInput {
  return { eventId: `${runId}:${type}`, occurredAt: at, type, payload } as RunEventInput;
}
