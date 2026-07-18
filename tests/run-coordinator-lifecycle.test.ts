import { describe, expect, it, vi } from "vitest";
import {
  LEGAL_LIFECYCLE_TRANSITIONS,
  RunCoordinator,
  assertLifecycleTransition,
  foldRun,
  type RunEvent,
  type RunLifecycle
} from "@manyhands/run-coordinator";

describe("RunCoordinator lifecycle", () => {
  it("accepts exactly the declared lifecycle transitions", () => {
    const states: RunLifecycle[] = [
      "planning", "needs_approval", "running", "waiting_for_input", "paused",
      "cancelling", "interrupted", "result_ready", "delivering", "completed", "failed"
    ];
    for (const from of states) {
      for (const to of states) {
        const allowed = from === to || LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
        if (allowed) expect(() => assertLifecycleTransition(from, to)).not.toThrow();
        else expect(() => assertLifecycleTransition(from, to)).toThrow(/illegal lifecycle transition/i);
      }
    }
  });

  it("folds the successful lifecycle from facts", () => {
    const state = foldRun([
      event(1, "run.created", { goal: "Build booking app" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      event(4, "final_candidate.verified", candidatePayload()),
      event(5, "delivery.started", { approval: deliveryApproval() }),
      event(6, "delivery.published", { receipt: { receiptId: "delivery-1", manifestId: "manifest-1", destination: "main", confirmed: true } })
    ]);

    expect(state.lifecycle).toBe("completed");
    expect(state.outcomes).toEqual({ execution: "succeeded", artifact: "verified", delivery: "published" });
    expect(state.deliveryReceipt?.receiptId).toBe("delivery-1");
  });

  it("requires eligible final evidence and a confirmed delivery receipt for completed", () => {
    expect(() => foldRun([
      event(1, "run.created", { goal: "Build it" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      event(4, "final_candidate.verified", { ...candidatePayload(), evidenceEligible: false })
    ])).toThrow(/evidence/i);

    expect(() => foldRun([
      event(1, "run.created", { goal: "Build it" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      event(4, "final_candidate.verified", candidatePayload()),
      event(5, "delivery.started", { approval: deliveryApproval() }),
      event(6, "delivery.published", { receipt: { receiptId: "delivery-1", manifestId: "manifest-1", destination: "main", confirmed: false } })
    ])).toThrow(/confirmed/i);
  });

  it("waits for input only when no independent work remains ready", () => {
    const prefix = [
      event(1, "run.created", { goal: "Build it" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      event(4, "decision.raised", {
        decision: {
          id: "decision-a",
          kind: "resolve_conflict",
          question: "Which behavior should node A implement?",
          options: [{ id: "one", label: "Behavior one" }, { id: "two", label: "Behavior two" }],
          affectedNodeIds: ["node-a"],
          evidenceRefs: ["evidence-1"],
          impact: "behavior"
        }
      })
    ] as RunEvent[];

    expect(foldRun([...prefix, event(5, "readiness.observed", { readyNodeIds: ["node-b"], pendingDecisionIds: ["decision-a"] })]).lifecycle).toBe("running");
    expect(foldRun([...prefix, event(5, "readiness.observed", { readyNodeIds: [], pendingDecisionIds: ["decision-a"] })]).lifecycle).toBe("waiting_for_input");
  });

  it("publishes delivery through a port and records the receipt only after the effect", async () => {
    const events: RunEvent[] = [
      event(1, "run.created", { goal: "Build it" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      event(4, "final_candidate.verified", candidatePayload())
    ];
    const publish = vi.fn().mockResolvedValue({ receiptId: "delivery-1", manifestId: "manifest-1", destination: "main", confirmed: true });
    const coordinator = new RunCoordinator({
      events: {
        load: async () => [...events],
        append: async (_runId, expectedSequence, inputs) => {
          expect(expectedSequence).toBe(events.length);
          const appended = inputs.map((input, index) => event(expectedSequence + index + 1, input.type, input.payload));
          events.push(...appended);
          return appended;
        }
      },
      delivery: { publish },
      clock: () => "2026-07-17T00:00:00.000Z",
      eventId: (type, sequence) => `${type}-${sequence}`
    });

    const state = await coordinator.execute("run-1", { type: "publish_delivery", approval: deliveryApproval() });

    expect(publish).toHaveBeenCalledWith({ runId: "run-1", approval: deliveryApproval() });
    expect(events.slice(-2).map((item) => item.type)).toEqual(["delivery.started", "delivery.published"]);
    expect(state.lifecycle).toBe("completed");
  });

  it("invalidates authority before stopping processes and accepts interruption only when all are dead", async () => {
    const events: RunEvent[] = [
      event(1, "run.created", { goal: "Build it" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 })
    ];
    const actions: string[] = [];
    const coordinator = new RunCoordinator({
      events: {
        load: async () => [...events],
        append: async (_runId, expectedSequence, inputs) => {
          actions.push(`append:${inputs.map((input) => input.type).join(",")}`);
          const appended = inputs.map((input, index) => event(expectedSequence + index + 1, input.type, input.payload));
          events.push(...appended);
          return appended;
        }
      },
      delivery: { publish: async () => { throw new Error("not used"); } },
      cancellation: {
        invalidateAuthority: async () => { actions.push("invalidate"); return { invalidationReceiptId: "invalidation-1" }; },
        stopProcesses: async () => { actions.push("stop"); return { processReceiptId: "processes-1", allDead: true }; }
      },
      clock: () => "2026-07-17T00:00:00.000Z",
      eventId: (type, sequence) => `${type}-${sequence}`
    });

    const state = await coordinator.execute("run-1", { type: "cancel", reason: "User cancelled" });

    expect(actions).toEqual(["invalidate", "append:operation.cancel_requested", "stop", "append:operation.interrupted"]);
    expect(state.lifecycle).toBe("interrupted");
    expect(state.outcomes.execution).toBe("interrupted");
  });

  it("restarts an explicitly interrupted run without rewriting its prior outcome", () => {
    const state = foldRun([
      event(1, "run.created", { goal: "Build it" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      event(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      event(4, "operation.cancel_requested", { invalidationReceiptId: "fence-2", reason: "Restart test" }),
      event(5, "operation.interrupted", { processReceiptId: "processes-1", allDead: true }),
      event(6, "run.restart_requested", { reason: "Operator requested recovery" })
    ]);

    expect(state.lifecycle).toBe("running");
    expect(state.outcomes.execution).toBe("pending");
  });

  it("previews domain validity before appending a command event", async () => {
    const events: RunEvent[] = [
      event(1, "run.created", { goal: "Build it" }),
      event(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 })
    ];
    const append = vi.fn();
    const coordinator = new RunCoordinator({
      events: { load: async () => events, append },
      delivery: { publish: async () => { throw new Error("not used"); } },
      clock: () => "2026-07-17T00:00:00.000Z",
      eventId: (type, sequence) => `${type}-${sequence}`
    });

    await expect(coordinator.execute("run-1", { type: "approve_graph", graphId: "graph-1", revision: 2 })).rejects.toThrow(/current.*revision 1/i);
    expect(append).not.toHaveBeenCalled();
  });
});

function event<T extends RunEvent["type"]>(sequence: number, type: T, payload: Extract<RunEvent, { type: T }>["payload"]): Extract<RunEvent, { type: T }> {
  return {
    eventId: `event-${sequence}`,
    runId: "run-1",
    sequence,
    occurredAt: "2026-07-17T00:00:00.000Z",
    type,
    payload
  } as Extract<RunEvent, { type: T }>;
}

function candidatePayload() {
  return { manifestId: "manifest-1", commit: "abc123", evidenceMatrixId: "matrix-1", evidenceEligible: true, executionSucceeded: true, sourceTargetFingerprint: "repo@base", targetBranch: "main", targetHead: "base-sha" } as const;
}

function deliveryApproval() {
  return { manifestId: "manifest-1", finalSha: "abc123", targetBranch: "main", targetHead: "base-sha", targetFingerprint: "repo@base", actor: "operator", idempotencyKey: "delivery-key-1" } as const;
}
