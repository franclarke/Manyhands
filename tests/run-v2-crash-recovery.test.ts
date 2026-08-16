import { describe, expect, it } from "vitest";

import {
  RunCoordinator,
  RunEventSchema,
  type DeliveryApproval,
  type DeliveryReceipt,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";

const at = "2026-07-18T12:00:00.000Z";

describe("V2 crash recovery", () => {
  it("resumes delivery after the side effect succeeded but receipt persistence crashed", async () => {
    const approval: DeliveryApproval = {
      manifestId: "manifest-final",
      finalSha: "f".repeat(40),
      targetBranch: "main",
      targetHead: "b".repeat(40),
      targetFingerprint: "sha256:target",
      actor: "operator",
      idempotencyKey: "delivery-once"
    };
    const receipt: DeliveryReceipt = {
      receiptId: "receipt-final",
      requestFingerprint: "sha256:request",
      manifestId: approval.manifestId,
      finalSha: approval.finalSha,
      targetBranch: approval.targetBranch,
      targetHeadBefore: approval.targetHead,
      targetHeadAfter: approval.finalSha,
      disposition: "delivered",
      destination: "repo#main",
      confirmed: true
    };
    let events = resultReadyEvents(approval);
    let crashReceiptAppend = true;
    let publishCalls = 0;
    const coordinator = new RunCoordinator({
      events: {
        load: async () => structuredClone(events),
        append: async (runId, expectedSequence, inputs) => {
          if (inputs.some((input) => input.type === "delivery.published") && crashReceiptAppend) {
            crashReceiptAppend = false;
            throw new Error("simulated crash while persisting receipt");
          }
          expect(expectedSequence).toBe(events.length);
          const appended = inputs.map((input, index) => RunEventSchema.parse({
            ...input,
            runId,
            sequence: expectedSequence + index + 1
          }));
          events = [...events, ...appended];
          return appended;
        }
      },
      delivery: {
        publish: async () => {
          publishCalls += 1;
          return receipt;
        }
      },
      clock: () => at,
      eventId: (type, sequence) => `${type}:${sequence}`
    });

    await expect(coordinator.execute("run-delivery", { type: "publish_delivery", approval }))
      .rejects.toThrow("simulated crash while persisting receipt");
    expect(events.at(-1)?.type).toBe("delivery.started");
    expect(events.some((event) => event.type === "delivery.failed")).toBe(false);

    const recovered = await coordinator.execute("run-delivery", { type: "publish_delivery", approval });

    expect(recovered.lifecycle).toBe("completed");
    expect(recovered.deliveryReceipt).toEqual(receipt);
    expect(publishCalls).toBe(2);
    expect(events.filter((event) => event.type === "delivery.started")).toHaveLength(1);
  });
});

function resultReadyEvents(approval: DeliveryApproval): RunEvent[] {
  const inputs: RunEventInput[] = [
    { eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Ship the application" } },
    { eventId: "proposed", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph", revision: 1 } },
    { eventId: "approved", occurredAt: at, type: "graph.revision.approved", payload: { graphId: "graph", revision: 1 } },
    {
      eventId: "matrix",
      occurredAt: at,
      type: "evidence.matrix_recorded",
      payload: {
        matrix: {
          matrixId: "matrix-final",
          candidateCommit: approval.finalSha,
          validationContract: { id: "validation-final", revision: "revision-1" },
          criteria: [{
            criterionId: "criterion-final",
            obligationId: "obligation-final",
            status: "satisfied",
            justification: "The exact candidate passed.",
            evidenceRefs: ["evidence-final"]
          }],
          outcome: "verified",
          evidenceBindings: [],
          observations: []
        }
      }
    },
    {
      eventId: "final",
      occurredAt: at,
      type: "final_candidate.verified",
      payload: {
        manifestId: approval.manifestId,
        commit: approval.finalSha,
        evidenceMatrixId: "matrix-final",
        evidenceEligible: true,
        executionSucceeded: true,
        sourceTargetFingerprint: approval.targetFingerprint,
        targetBranch: approval.targetBranch,
        targetHead: approval.targetHead
      }
    }
  ];
  return inputs.map((input, index) => RunEventSchema.parse({
    ...input,
    runId: "run-delivery",
    sequence: index + 1
  }));
}
