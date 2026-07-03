import { describe, expect, it } from "vitest";
import {
  planCompletionEvents,
  planNodeProposedEvent,
  planNodeStatusEvent
} from "@/lib/server/runs/planning-run-model-adapter";

describe("planning → run-model adapter", () => {
  it("proposes the root with role root and a null parent", () => {
    const event = planNodeProposedEvent(
      { nodeId: "root", parentId: null, title: "Contador", goal: "Build it", depth: 0 },
      "root"
    );
    expect(event.type).toBe("plan.node.proposed");
    expect(event.actor).toBe("system");
    expect(event.payload).toEqual({
      nodeId: "root",
      parentId: null,
      role: "root",
      title: "Contador",
      goal: "Build it",
      depth: 0
    });
  });

  it("proposes a child as a leaf under its parent at the next depth", () => {
    const event = planNodeProposedEvent(
      { nodeId: "store", parentId: "root", title: "CounterStore", goal: "state", depth: 1 },
      "leaf"
    );
    expect(event.payload).toMatchObject({ nodeId: "store", parentId: "root", role: "leaf", depth: 1 });
  });

  it("emits native planning status telemetry for live placeholder nodes", () => {
    const event = planNodeStatusEvent({
      nodeId: "store",
      parentId: "root",
      title: "CounterStore",
      goal: "state",
      depth: 1,
      state: "retrying",
      attempt: 1,
      maxAttempts: 3,
      errorKind: "missing_json",
      errorMessage: "No JSON object found"
    });

    expect(event.type).toBe("plan.node.status");
    expect(event.actor).toBe("system");
    expect(event.payload).toEqual({
      nodeId: "store",
      state: "retrying",
      attempt: 1,
      maxAttempts: 3,
      errorKind: "missing_json",
      errorMessage: "No JSON object found"
    });
  });

  it("finalizes a plan with plan.ready and a blocking approve_plan decision", () => {
    const events = planCompletionEvents({
      rootId: "root",
      nodeCount: 3,
      seams: [],
      criticFindings: ["seam X has no consumer"],
      executableNodeIds: ["store", "ui"]
    });

    const ready = events.find((e) => e.type === "plan.ready");
    expect(ready?.payload).toEqual({ rootId: "root", nodeCount: 3, seamCount: 0, criticFindings: ["seam X has no consumer"] });

    const decision = events.find((e) => e.type === "decision.raised");
    expect(decision?.payload).toMatchObject({
      decisionId: "approve_plan",
      kind: "approve_plan",
      blocking: true,
      context: { nodeIds: ["store", "ui"] }
    });
  });

  it("emits a seam draft before the readiness milestone when seams exist", () => {
    const events = planCompletionEvents({
      rootId: "root",
      nodeCount: 2,
      seams: [{ seamId: "CounterApi", name: "CounterApi", producerNodeId: "store", consumerNodeIds: ["ui"], draftSignature: "inc(): number" }],
      criticFindings: [],
      executableNodeIds: ["store", "ui"]
    });

    expect(events.map((e) => e.type)).toEqual(["plan.seam.proposed", "plan.ready", "decision.raised"]);
    const seam = events[0];
    expect(seam?.payload).toMatchObject({ seamId: "CounterApi", producerNodeId: "store", consumerNodeIds: ["ui"] });
    expect((events.find((e) => e.type === "plan.ready")?.payload as { seamCount: number }).seamCount).toBe(1);
  });
});
