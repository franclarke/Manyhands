import { afterEach, describe, expect, it } from "vitest";

import { TARGET_CLEANLINESS_POLICY_ID } from "@manyhands/execution-core";
import { DeliveryReceiptSchema, foldRun, type RunEvent } from "@manyhands/run-coordinator";

import { createCurrentDeliveryPort } from "../apps/daemon/src/current-lifecycle-adapters.js";

import {
  buildDeliveryTargetFixture,
  git,
  removeDeliveryTargetFixture,
  stage10Approval,
  stage10Definition,
  stage10Projection,
  type Stage10DeliveryTarget
} from "./helpers/stage10-delivery-fixture.js";

const at = "2026-08-15T00:00:00.000Z";
const targets: Stage10DeliveryTarget[] = [];

afterEach(async () => {
  await Promise.all(targets.splice(0).map(removeDeliveryTargetFixture));
});

/**
 * The receipt named the delivered commit and nothing about its content. Two
 * commits can carry the same tree and a commit can be rewritten under a ref, so
 * "we published SHA X" is not the same claim as "the target holds this tree".
 * Stage 10 is about the second claim, and only the tree can carry it.
 *
 * The cleanliness policy is recorded for the same reason: a reader six months
 * later cannot tell whether `.manyhands/` was exempt when this delivery was
 * judged unless the receipt says which rule judged it.
 */
describe("Delivery receipt", () => {
  it("binds the exact delivered tree and the policy that judged the target", async () => {
    const fixture = await target();

    const receipt = await publish(fixture);

    expect(receipt.deliveredTreeSha).toBe(await git(fixture.root, "rev-parse", `${fixture.candidateSha}^{tree}`));
    expect(receipt.deliveredTreeSha).toBe(fixture.treeSha);
    expect(receipt.cleanlinessPolicyId).toBe(TARGET_CLEANLINESS_POLICY_ID);
  });

  it("carries the same tree through a recovered delivery", async () => {
    const fixture = await target();

    const first = await publish(fixture);
    const recovered = await publish(fixture);

    expect(recovered).toEqual(first);
    expect(recovered.deliveredTreeSha).toBe(fixture.treeSha);
  });

  it("refuses a receipt whose delivered tree is not the verified manifest's tree", () => {
    // The manifest is what the evidence was gathered against. A receipt for a
    // different tree is a delivery of something nobody validated.
    const events = [...readyEvents(), publishedEvent({ deliveredTreeSha: "tree-that-nobody-verified" })];

    // Named precisely: before the field existed this assertion passed on the
    // strict schema rejecting an unknown key, which proves nothing.
    expect(() => foldRun(events))
      .toThrow("Delivery receipt delivered tree does not match the verified final manifest tree.");
  });

  it("accepts the verified manifest's tree", () => {
    const events = [...readyEvents(), publishedEvent({ deliveredTreeSha: "tree-sha" })];

    expect(foldRun(events).outcomes.delivery).toBe("published");
  });

  it("still loads a historical receipt recorded before the tree was bound", () => {
    // Delivered runs predate this field — `run:e57c0076…` among them — and a
    // journal that no longer replays is a worse outcome than one missing a
    // field.
    const events = [...readyEvents(), publishedEvent({})];

    expect(DeliveryReceiptSchema.safeParse(publishedEvent({}).payload.receipt).success).toBe(true);
    expect(foldRun(events).outcomes.delivery).toBe("published");
  });
});

async function target(): Promise<Stage10DeliveryTarget> {
  const fixture = await buildDeliveryTargetFixture();
  targets.push(fixture);
  return fixture;
}

function publish(fixture: Stage10DeliveryTarget) {
  return createCurrentDeliveryPort().publish({
    runId: "run:stage10-receipt",
    definition: stage10Definition(fixture),
    approval: stage10Approval(fixture),
    projection: stage10Projection(fixture),
    events: []
  });
}

const approval = {
  manifestId: "manifest-1",
  finalSha: "candidate-sha",
  targetBranch: "main",
  targetHead: "base-sha",
  targetFingerprint: "repo@base",
  actor: "operator",
  idempotencyKey: "delivery-key-1"
};

function publishedEvent(overrides: { deliveredTreeSha?: string }) {
  return event(7, "delivery.published", {
    receipt: {
      receiptId: "receipt-1",
      requestFingerprint: "request-1",
      manifestId: approval.manifestId,
      finalSha: approval.finalSha,
      targetBranch: approval.targetBranch,
      targetHeadBefore: approval.targetHead,
      targetHeadAfter: approval.finalSha,
      disposition: "delivered" as const,
      confirmed: true,
      ...overrides
    }
  });
}

function readyEvents(): RunEvent[] {
  return [
    event(1, "run.created", { goal: "Build it" }),
    event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
    event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
    event(4, "evidence.matrix_recorded", { matrix: verifiedMatrix() }),
    event(5, "final_candidate.verified", {
      manifestId: "manifest-1",
      commit: "candidate-sha",
      evidenceMatrixId: "matrix-1",
      evidenceEligible: true,
      executionSucceeded: true,
      sourceTargetFingerprint: "repo@base",
      targetBranch: "main",
      targetHead: "base-sha",
      finalManifest: {
        commitSha: "candidate-sha",
        treeSha: "tree-sha",
        graphRevision: 1,
        artifactIds: ["artifact-final"],
        evidenceMatrixId: "matrix-1",
        validationRecipeDigest: "sha256:recipe",
        deliveryTarget: "main"
      }
    }),
    event(6, "delivery.started", { approval })
  ];
}

function verifiedMatrix() {
  return {
    matrixId: "matrix-1",
    candidateCommit: "candidate-sha",
    validationContract: { id: "validation-final", revision: "revision-1" },
    criteria: [{
      criterionId: "criterion-final",
      obligationId: "obligation-final",
      status: "satisfied" as const,
      justification: "The exact candidate passed.",
      evidenceRefs: ["evidence-final"]
    }],
    outcome: "verified" as const,
    validationRecipeDigest: "sha256:recipe",
    observations: []
  };
}

function event<T extends RunEvent["type"]>(
  sequence: number,
  type: T,
  payload: Extract<RunEvent, { type: T }>["payload"]
): Extract<RunEvent, { type: T }> {
  return { eventId: `event-${sequence}`, runId: "run-1", sequence, occurredAt: at, type, payload } as Extract<RunEvent, { type: T }>;
}
