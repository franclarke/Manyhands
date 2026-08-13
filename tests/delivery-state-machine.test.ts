import { describe, expect, it, vi } from "vitest";
import { RunCoordinator, foldRun, type RunEvent } from "@manyhands/run-coordinator";
import { TransactionalDeliveryPublisher, deliveryRequestFingerprint } from "@manyhands/execution-core";

const approval = {
  manifestId: "manifest-1", finalSha: "candidate-sha", targetBranch: "main", targetHead: "base-sha",
  targetFingerprint: "repo@base", actor: "operator", idempotencyKey: "delivery-key-1"
};

describe("delivery state machine V2", () => {
  it("freezes the approved candidate and only completes from its confirmed delivered receipt", async () => {
    const events = readyEvents();
    const publish = vi.fn().mockResolvedValue({
      receiptId: "receipt-1", requestFingerprint: "request-1", manifestId: "manifest-1", finalSha: "candidate-sha",
      targetBranch: "main", targetHeadBefore: "base-sha", targetHeadAfter: "delivered-sha", disposition: "delivered", confirmed: true
    });
    const coordinator = coordinatorFor(events, publish);
    const state = await coordinator.execute("run-1", { type: "publish_delivery", approval });
    expect(publish).toHaveBeenCalledWith({ runId: "run-1", approval });
    expect(state.lifecycle).toBe("completed");
    expect(state.deliveryApproval).toEqual(approval);
    expect(state.finalCandidate?.finalManifest).toMatchObject({
      commitSha: "candidate-sha",
      treeSha: "tree-sha",
      graphRevision: 1,
      validationRecipeDigest: "sha256:recipe"
    });
  });

  it("records a resolvable failure and returns to result_ready when the target changed", async () => {
    const events = readyEvents();
    const coordinator = coordinatorFor(events, vi.fn().mockRejectedValue(new Error("target changed")));
    await expect(coordinator.execute("run-1", { type: "publish_delivery", approval })).rejects.toThrow(/target changed/i);
    const state = foldRun(events);
    expect(events.slice(-2).map((event) => event.type)).toEqual(["delivery.started", "delivery.failed"]);
    expect(state.lifecycle).toBe("result_ready");
    expect(state.outcomes.delivery).toBe("failed");
  });

  it("clears a retryable delivery failure after the same manifest is published", () => {
    const events = [
      ...readyEvents(),
      event(6, "delivery.started", { approval }),
      event(7, "delivery.failed", { manifestId: approval.manifestId, reason: "target dirty", retryable: true }),
      event(8, "delivery.started", { approval }),
      event(9, "delivery.published", {
        receipt: {
          receiptId: "receipt-1",
          requestFingerprint: "request-1",
          manifestId: approval.manifestId,
          finalSha: approval.finalSha,
          targetBranch: approval.targetBranch,
          targetHeadBefore: approval.targetHead,
          targetHeadAfter: approval.finalSha,
          disposition: "delivered",
          confirmed: true
        }
      })
    ];

    const state = foldRun(events);

    expect(state.lifecycle).toBe("completed");
    expect(state.outcomes.delivery).toBe("published");
    expect(state.failureReason).toBeUndefined();
  });

  it("checks the frozen target before publishing and adopts a prior receipt by idempotency key", async () => {
    const requestFingerprint = deliveryRequestFingerprint(approval);
    const receipt = { receiptId: "receipt-1", requestFingerprint, manifestId: approval.manifestId, finalSha: approval.finalSha, targetBranch: approval.targetBranch, targetHeadBefore: approval.targetHead, targetHeadAfter: "merge-sha", disposition: "delivered" as const, confirmed: true as const };
    const publish = vi.fn().mockResolvedValue(receipt);
    const complete = vi.fn();
    const publisher = new TransactionalDeliveryPublisher({
      journal: { claim: async () => ({ requestFingerprint }), complete },
      repository: { inspect: async () => ({ branch: "main", head: "changed", fingerprint: "repo@base", clean: true }), recover: async () => undefined, publish }
    });
    await expect(publisher.publish(approval)).rejects.toThrow(/target changed/i);
    expect(publish).not.toHaveBeenCalled();

    const retry = new TransactionalDeliveryPublisher({
      journal: { claim: async () => ({ requestFingerprint, receipt }), complete },
      repository: { inspect: vi.fn(), recover: vi.fn(), publish }
    });
    expect(await retry.publish(approval)).toEqual(receipt);
    expect(publish).not.toHaveBeenCalled();
  });
});

function readyEvents(): RunEvent[] {
  return [
    event(1, "run.created", { goal: "Build it" }),
    event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
    event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
    event(4, "evidence.matrix_recorded", { matrix: verifiedMatrix("matrix-1", "candidate-sha") }),
    event(5, "final_candidate.verified", { manifestId: "manifest-1", commit: "candidate-sha", evidenceMatrixId: "matrix-1", evidenceEligible: true, executionSucceeded: true, sourceTargetFingerprint: "repo@base", targetBranch: "main", targetHead: "base-sha", finalManifest: { commitSha: "candidate-sha", treeSha: "tree-sha", graphRevision: 1, artifactIds: ["artifact-final"], evidenceMatrixId: "matrix-1", validationRecipeDigest: "sha256:recipe", deliveryTarget: "main" } })
  ];
}
function verifiedMatrix(matrixId: string, candidateCommit: string) {
  return { matrixId, candidateCommit, validationContract: { id: "validation-final", revision: "revision-1" }, criteria: [{ criterionId: "criterion-final", obligationId: "obligation-final", status: "satisfied" as const, justification: "The exact candidate passed.", evidenceRefs: ["evidence-final"] }], outcome: "verified" as const, validationRecipeDigest: "sha256:recipe", observations: [] };
}
function coordinatorFor(events: RunEvent[], publish: ReturnType<typeof vi.fn>): RunCoordinator {
  return new RunCoordinator({ events: { load: async () => [...events], append: async (_id, expected, inputs) => { const added = inputs.map((input, index) => event(expected + index + 1, input.type, input.payload)); events.push(...added); return added; } }, delivery: { publish }, clock: () => "2026-07-17T00:00:00.000Z", eventId: (type, sequence) => `${type}-${sequence}` });
}
function event<T extends RunEvent["type"]>(sequence: number, type: T, payload: Extract<RunEvent, { type: T }>["payload"]): Extract<RunEvent, { type: T }> {
  return { eventId: `event-${sequence}`, runId: "run-1", sequence, occurredAt: "2026-07-17T00:00:00.000Z", type, payload } as Extract<RunEvent, { type: T }>;
}
