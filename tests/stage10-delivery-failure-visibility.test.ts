import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DigestHasher } from "@manyhands/contracts";
import type {
  ProductRunDefinition,
  RunEvent,
  RunEventInput,
  RunProjection
} from "@manyhands/run-coordinator";
import type { RunActorReactionContext } from "@manyhands/run-engine";
import { JsonlRunEventStore } from "@manyhands/run-store";

import { createProductRunApplication } from "../apps/daemon/src/product-run-application.js";
import { createTransitionalUnsafeProfile } from "../apps/daemon/src/transitional-unsafe-profile.js";

const at = "2026-08-15T00:00:00.000Z";
const runId = "run:stage10-delivery-failure";
const daemonEpoch = "epoch-stage10";
const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

/**
 * The live run of 2026-08-15 delivered, which left the failure path unexercised
 * and hid two defects that make a failed delivery unobservable.
 *
 * The adapter throws when publication rejects. Nothing catches it: the thrown
 * error lands on a queue only `drainEffects()` reads, and the IPC-serving daemon
 * never drains. A diverged target parks the run at `effect.requested` forever —
 * no `delivery.failed`, no diagnostic, nothing an operator can act on. This is
 * the defect fixed for `model_call` in `fb16e5ac`; delivery was not fixed too.
 *
 * And when a succeeded observation arrives without its durable delivery result,
 * the actor synthesises a receipt claiming `confirmed: true` for a head nobody
 * observed. The planning branch beside it fails closed instead. A crash between
 * the physical publish and the durable write is precisely the window Stage 10
 * exists to close, and today it is reported as a successful delivery.
 */
describe("Delivery failure visibility", () => {
  it("records a failed observation when publication rejects", async () => {
    const stateRoot = await temporaryDirectory();
    await seedDeliveryReadyRun(stateRoot);
    const recorded: Array<{ observation: string; reason?: string }> = [];

    const adapter = deliveryAdapter(stateRoot, async () => {
      throw new Error("The delivery target changed immediately before publication; nothing was published.");
    });

    await expect(adapter.execute(deliveryIntent(), {
      observerDaemonEpoch: daemonEpoch,
      inputSpec: { payload: {} } as never,
      priorReceipts: [],
      record: async (observation: { observation: string; reason?: string }) => {
        recorded.push(observation);
        return {} as never;
      }
    } as never)).resolves.toBeUndefined();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.observation).toBe("failed");
    expect(recorded[0]!.reason).toMatch(/nothing was published/u);
  });

  it("records nothing when the effect was invalidated instead of failing", async () => {
    const stateRoot = await temporaryDirectory();
    await seedDeliveryReadyRun(stateRoot);
    const recorded: unknown[] = [];

    const adapter = deliveryAdapter(stateRoot, async () => {
      throw new Error("publication must not run for an invalidated effect");
    });

    // A cancelled delivery is not a failed one. Recording a failure here would
    // turn an operator's cancellation into a defect in the run's record.
    await expect(adapter.execute(deliveryIntent(), {
      observerDaemonEpoch: daemonEpoch,
      inputSpec: { payload: {} } as never,
      priorReceipts: [],
      invalidationReason: async () => "cancelled by operator",
      record: async (observation: unknown) => {
        recorded.push(observation);
        return {} as never;
      }
    } as never)).resolves.toBeUndefined();

    expect(recorded).toHaveLength(0);
  });

  it("refuses to publish a receipt the adapter never produced", async () => {
    const application = createProductRunApplication({
      hasher: sha256,
      clock: () => at,
      executionProcess: () => ({ executable: process.execPath, argv: [], cwd: process.cwd(), env: {} }),
      // The durable result is gone — the crash window between the physical
      // publish and the write that records it.
      loadDeliveryResult: async () => undefined as never
    });

    const reaction = await application.react({
      intent: deliveryIntent(),
      receipts: [],
      terminal: {
        eventId: "effect:delivery:completed",
        occurredAt: at,
        type: "effect.completed",
        payload: { effectId: deliveryIntent().effectId, receiptId: "receipt:delivery" }
      }
    } as never, reactionContext());

    expect(reaction.domainEvents.map(({ type }) => type)).toEqual(["delivery.failed"]);
    const failure = reaction.domainEvents[0] as RunEventInput & {
      payload: { reason: string; manifestId: string };
    };
    expect(failure.payload.manifestId).toBe("manifest-stage10");
    expect(failure.payload.reason).toMatch(/durable/iu);
  });
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mh-stage10-delivery-"));
  temporaryDirectories.push(directory);
  return directory;
}

function deliveryAdapter(stateRoot: string, publish: () => Promise<never>) {
  const profile = createTransitionalUnsafeProfile({
    stateRoot,
    nodeExecutable: process.execPath,
    workerScriptPath: path.join(stateRoot, "worker.js"),
    cwd: stateRoot,
    planner: { plan: async () => { throw new Error("unused"); } },
    delivery: { publish }
  });
  const adapter = profile.adapters.find(({ kind }) => kind === "delivery");
  if (adapter === undefined) throw new Error("The transitional profile has no delivery adapter.");
  return adapter;
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
    manifestId: "manifest-stage10",
    finalSha: "candidate-stage10",
    targetBranch: "main",
    targetHead: "base-stage10",
    targetFingerprint: "target:stage10",
    actor: "operator",
    idempotencyKey: "delivery-stage10"
  };
}

function definition(): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage10",
    userPrompt: "Exercise the delivery failure path",
    acceptanceCriteria: ["delivery fails visibly"],
    title: "Stage 10 delivery failure",
    planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
    repairSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionConfig: {},
    targetContext: {
      fingerprint: "target:stage10",
      sourceBaseCommit: "base-stage10",
      sourceBranch: "main",
      sourceRealPath: process.cwd()
    }
  };
}

/** The adapter folds the run, so the approval has to be reachable from the journal. */
async function seedDeliveryReadyRun(stateRoot: string): Promise<void> {
  const events = new JsonlRunEventStore({ directory: path.join(stateRoot, "runs") });
  const authority = await events.claimAuthority(runId, "stage10-delivery-failure");
  await events.bind(authority).append(runId, 0, [
    {
      eventId: `${runId}:created`,
      occurredAt: at,
      type: "run.created",
      payload: { goal: definition().userPrompt, definition: definition() }
    },
    input("graph.revision.proposed", { graphId: "graph-stage10", revision: 1 }),
    input("graph.revision.approved", { graphId: "graph-stage10", revision: 1 }),
    input("evidence.matrix_recorded", { matrix: verifiedMatrix() }),
    input("final_candidate.verified", {
      manifestId: "manifest-stage10",
      commit: "candidate-stage10",
      evidenceMatrixId: "matrix-stage10",
      evidenceEligible: true,
      executionSucceeded: true,
      sourceTargetFingerprint: "target:stage10",
      targetBranch: "main",
      targetHead: "base-stage10",
      finalManifest: {
        commitSha: "candidate-stage10",
        treeSha: "tree-stage10",
        graphRevision: 1,
        artifactIds: ["artifact-stage10"],
        evidenceMatrixId: "matrix-stage10",
        validationRecipeDigest: "sha256:recipe-stage10",
        deliveryTarget: "main"
      }
    }),
    input("delivery.started", { approval: approval() })
  ]);
}

function verifiedMatrix() {
  return {
    matrixId: "matrix-stage10",
    candidateCommit: "candidate-stage10",
    validationContract: { id: "validation-stage10", revision: "revision-1" },
    criteria: [{
      criterionId: "criterion-stage10",
      obligationId: "obligation-stage10",
      status: "satisfied" as const,
      justification: "The validator checked the exact candidate.",
      evidenceRefs: ["evidence-stage10"]
    }],
    outcome: "verified" as const,
    validationRecipeDigest: "sha256:recipe-stage10",
    evidenceBindings: [],
    observations: []
  };
}

function input(type: string, payload: Record<string, unknown>): RunEventInput {
  return { eventId: `${runId}:${type}`, occurredAt: at, type, payload } as RunEventInput;
}

/**
 * The actor reads the approval from `delivery.started` in the projection.
 *
 * It used to read it out of the accepted `deliver_run` command, which Stage 11
 * broke: a run that publishes under a delegated authorization has no such
 * command, and a delivery the actor cannot describe is one it cannot report as
 * failed. `delivery.started` is the fact the reducer already validates receipts
 * against, so it is the same authority whoever authorized the publication.
 */
function reactionContext(): RunActorReactionContext {
  return {
    runId,
    daemonEpoch,
    currentRevision: 1,
    acceptedRevision: 2,
    events: [] as RunEvent[],
    projection: { sequence: 1, deliveryApproval: approval() } as RunProjection
  } as RunActorReactionContext;
}
