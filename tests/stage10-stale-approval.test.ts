import { describe, expect, it } from "vitest";

import { DecisionSchema, foldRun, type RunEvent } from "@manyhands/run-coordinator";

const at = "2026-08-15T00:00:00.000Z";

/**
 * R13: an approval authorizes one candidate, not the act of delivering.
 *
 * This task was written to be falsifiable — the invariant may already hold, in
 * which case these are regression guards and the finding is that no change was
 * needed. That is what happened, and each case below names the reducer rule
 * that already refuses it.
 */
describe("A changed candidate invalidates its delivery approval", () => {
  it("refuses to start a delivery whose approval is not the current candidate", () => {
    // reducer.ts `delivery.started`: the approval must name the current final
    // candidate by manifest and commit. Reached directly, because a second
    // verified candidate cannot be recorded at all — see the case below.
    const events = [
      ...readyEvents(),
      event(6, "delivery.started", { approval: approvalFor("manifest-2", "candidate-2") })
    ];

    expect(() => foldRun(events)).toThrow(/not the verified final candidate/iu);
  });

  it("cannot record a second verified candidate once a result is ready", () => {
    // The probe found the window closed earlier than R13 assumed. A run that
    // reached `result_ready` refuses new validation evidence outright, so the
    // approved candidate cannot be superseded while an approval is outstanding;
    // producing a different one requires a new run or an amendment that returns
    // the run to `running` first.
    const events = [
      ...readyEvents(),
      event(6, "evidence.matrix_recorded", { matrix: verifiedMatrix("matrix-2", "candidate-2") })
    ];

    expect(() => foldRun(events)).toThrow(/Cannot record validation evidence while result_ready/iu);
  });

  it("refuses to publish a receipt for a superseded manifest", () => {
    // The dangerous ordering: the approval was current when delivery started
    // and the candidate moved underneath it.
    const events = [
      ...readyEvents(),
      event(6, "delivery.started", { approval: approvalFor("manifest-1", "candidate-1") }),
      event(7, "delivery.published", {
        receipt: {
          receiptId: "receipt-2",
          requestFingerprint: "request-2",
          manifestId: "manifest-2",
          finalSha: "candidate-2",
          targetBranch: "main",
          targetHeadBefore: "base-sha",
          targetHeadAfter: "candidate-2",
          disposition: "delivered" as const,
          confirmed: true
        }
      })
    ];

    expect(() => foldRun(events)).toThrow(/evidence-eligible final candidate/iu);
  });

  it("refuses a receipt that names the approved manifest but another commit", () => {
    const events = [
      ...readyEvents(),
      event(6, "delivery.started", { approval: approvalFor("manifest-1", "candidate-1") }),
      event(7, "delivery.published", {
        receipt: {
          receiptId: "receipt-1",
          requestFingerprint: "request-1",
          manifestId: "manifest-1",
          finalSha: "candidate-2",
          targetBranch: "main",
          targetHeadBefore: "base-sha",
          targetHeadAfter: "candidate-2",
          disposition: "delivered" as const,
          confirmed: true
        }
      })
    ];

    expect(() => foldRun(events)).toThrow(/final SHA does not match the approved candidate/iu);
  });

  it("cannot verify a new final candidate while a delivery is in flight", () => {
    // And once delivering, the same refusal applies, so the approval cannot go
    // stale underneath an active publication either.
    const events = [
      ...readyEvents(),
      event(6, "delivery.started", { approval: approvalFor("manifest-1", "candidate-1") }),
      event(7, "evidence.matrix_recorded", { matrix: verifiedMatrix("matrix-2", "candidate-2") })
    ];

    expect(() => foldRun(events)).toThrow(/Cannot record validation evidence while delivering/iu);
  });

  it("has no productive producer for an approve_delivery decision", () => {
    // The kind exists in the decision vocabulary and nothing raises it: delivery
    // is authorized by the durable `deliver_run` command, whose approval the
    // reducer checks above. Recording the gap is honest; inventing a decision
    // path to guard would be manufacturing the thing under test.
    expect(DecisionSchema.shape.kind.options).toContain("approve_delivery");
  });
});

function approvalFor(manifestId: string, finalSha: string) {
  return {
    manifestId,
    finalSha,
    targetBranch: "main",
    targetHead: "base-sha",
    targetFingerprint: "repo@base",
    actor: "operator",
    idempotencyKey: `delivery-${manifestId}`
  };
}

function readyEvents(): RunEvent[] {
  return [
    event(1, "run.created", { goal: "Build it" }),
    event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
    event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
    event(4, "evidence.matrix_recorded", { matrix: verifiedMatrix("matrix-1", "candidate-1") }),
    verified(5, "manifest-1", "candidate-1", "tree-1")
  ];
}

function verified(
  sequence: number,
  manifestId: string,
  commit: string,
  treeSha: string,
  matrixId = "matrix-1"
) {
  return event(sequence, "final_candidate.verified", {
    manifestId,
    commit,
    evidenceMatrixId: matrixId,
    evidenceEligible: true,
    executionSucceeded: true,
    sourceTargetFingerprint: "repo@base",
    targetBranch: "main",
    targetHead: "base-sha",
    finalManifest: {
      commitSha: commit,
      treeSha,
      graphRevision: 1,
      artifactIds: ["artifact-final"],
      evidenceMatrixId: matrixId,
      validationRecipeDigest: "sha256:recipe",
      deliveryTarget: "main"
    }
  });
}

function verifiedMatrix(matrixId: string, candidateCommit: string) {
  return {
    matrixId,
    candidateCommit,
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
