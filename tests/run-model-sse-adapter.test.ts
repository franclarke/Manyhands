/**
 * PR 11 — SSE→RunEvent adapter tests (pure, node environment).
 *
 * Two concerns:
 *  1) per-kind + whole-history mapping (legacy `StreamEvent[]` → envelope `RunEvent[]`);
 *  2) the round-trip that matters: adapt → reduce → project renders the live run
 *     through the SAME model the fixtures drive (nodes reach running/done/failed,
 *     clarify gates surface in the channel), proving the bridge is real.
 */
import { describe, expect, it } from "vitest";
import { adaptStreamEvent, adaptStreamHistory } from "@/lib/run-model/sse-adapter";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectRenderableNodeState } from "@/lib/run-model/selectors";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
import { buildDecisionChannelView } from "@/lib/run-model/decision-channel-view";
import { buildFocusView } from "@/lib/run-model/focus-view";
import type { StreamEvent } from "@/lib/server/runs/events";
import type { RunConfig, RunModel } from "@/lib/run-model/types";

const AT = "2026-06-06T00:00:00.000Z";
const STUB_CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "m",
  executionSelection: { executorId: "e", model: "m" },
  repairSelection: { executorId: "e", model: "m" }
};

function modelFromStream(events: StreamEvent[], runId = "run-x"): RunModel {
  const envelope = adaptStreamHistory(events, runId);
  return reduceRunEvents(createInitialRunModel({ id: runId, intent: "", workspaceId: "ws", config: STUB_CONFIG }), envelope);
}

// A small but representative legacy history: plan 3 nodes, gate, run two leaves
// (one passes, one fails), plus noise events that must be dropped.
const HISTORY: StreamEvent[] = [
  { kind: "status.changed", at: AT, status: "generating" },
  { kind: "planning.node.started", at: AT, nodeId: "root", title: "Root", goal: "coord", depth: 0 },
  { kind: "planning.node.started", at: AT, nodeId: "n-a", parentId: "root", title: "A", goal: "do a", depth: 1 },
  { kind: "planning.node.started", at: AT, nodeId: "n-b", parentId: "root", title: "B", goal: "do b", depth: 1 },
  { kind: "heartbeat", at: AT },
  { kind: "gate.required", at: AT, taskIds: ["n-a", "n-b"] },
  { kind: "agent.run.started", at: AT, taskId: "n-a" },
  { kind: "agent.run.started", at: AT, taskId: "n-b" },
  { kind: "agent.run.completed", at: AT, taskId: "n-a", success: true },
  { kind: "validation.completed", at: AT, taskId: "n-a", passed: true },
  { kind: "agent.run.completed", at: AT, taskId: "n-b", success: false }
];

describe("sse-adapter — per-kind mapping", () => {
  it("1. planning.node.started → plan.node.proposed (root inferred when no parent)", () => {
    const root = adaptStreamEvent({ kind: "planning.node.started", at: AT, nodeId: "root", title: "R", goal: "g", depth: 0 });
    expect(root).toHaveLength(1);
    expect(root[0]!.type).toBe("plan.node.proposed");
    expect(root[0]!.payload).toMatchObject({ nodeId: "root", parentId: null, role: "root", title: "R", depth: 0 });
    const leaf = adaptStreamEvent({ kind: "planning.node.started", at: AT, nodeId: "n", parentId: "root", title: "N", goal: "g", depth: 1 });
    expect(leaf[0]!.payload).toMatchObject({ parentId: "root", role: "leaf" });
  });

  it("2. planning.node.completed fans out to plan.node.proposed per child draft", () => {
    const mapped = adaptStreamEvent({
      kind: "planning.node.completed",
      at: AT,
      nodeId: "root",
      decision: "decompose",
      childIds: ["c1", "c2"],
      childNodes: [
        { nodeId: "c1", parentId: "root", title: "C1", goal: "g1", depth: 1 },
        { nodeId: "c2", parentId: "root", title: "C2", goal: "g2", depth: 1 }
      ]
    });
    expect(mapped).toHaveLength(2);
    expect(mapped.every((m) => m.type === "plan.node.proposed")).toBe(true);
    expect(mapped.map((m) => (m.payload as { nodeId: string }).nodeId)).toEqual(["c1", "c2"]);
  });

  it("3. planning.question → decision.raised { clarify } with question + options", () => {
    const mapped = adaptStreamEvent({ kind: "planning.question", at: AT, nodeId: "n", question: "¿Formato?", options: ["CSV", "PDF"] });
    expect(mapped[0]!.type).toBe("decision.raised");
    expect(mapped[0]!.payload).toMatchObject({ kind: "clarify", blocking: true, context: { nodeIds: ["n"], question: "¿Formato?", options: ["CSV", "PDF"] } });
  });

  it("4. gate.required → decision.raised { approve_plan }", () => {
    const mapped = adaptStreamEvent({ kind: "gate.required", at: AT, taskIds: ["n-a"] });
    expect(mapped[0]!.payload).toMatchObject({ kind: "approve_plan", blocking: true, context: { nodeIds: ["n-a"] } });
  });

  it("5. agent.run.* → started / verify.passed (success) / execution.failed (failure)", () => {
    expect(adaptStreamEvent({ kind: "agent.run.started", at: AT, taskId: "n" })[0]!.type).toBe("node.execution.started");
    expect(adaptStreamEvent({ kind: "agent.run.completed", at: AT, taskId: "n", success: true })[0]!.type).toBe("node.verify.passed");
    expect(adaptStreamEvent({ kind: "agent.run.completed", at: AT, taskId: "n", success: false })[0]!.type).toBe("node.execution.failed");
  });

  it("6. status.changed maps approval lifecycle into decisions/outcome", () => {
    expect(adaptStreamEvent({ kind: "status.changed", at: AT, status: "needs_review" })[0]!.payload).toMatchObject({
      decisionId: "approve_plan",
      kind: "approve_plan"
    });
    expect(adaptStreamEvent({ kind: "status.changed", at: AT, status: "approved" })[0]!.payload).toMatchObject({
      decisionId: "approve_plan",
      choice: { action: "approve" }
    });
    expect(adaptStreamEvent({ kind: "status.changed", at: AT, status: "completed" }).map((event) => event.type)).toEqual([
      "decision.resolved",
      "run.completed"
    ]);
  });

  it("6b. noise events (generating status/title/heartbeat/replay/cli/node.added/edge.added/risk.added/validation) are dropped", () => {
    const noise: StreamEvent[] = [
      { kind: "status.changed", at: AT, status: "generating" },
      { kind: "title.updated", at: AT, title: "t", summary: "s" },
      { kind: "heartbeat", at: AT },
      { kind: "replay.start", at: AT },
      { kind: "replay.end", at: AT },
      { kind: "planning.cli.output", at: AT, nodeId: "n", chunk: "x", stream: "stdout" },
      { kind: "node.added", at: AT, taskId: "n" },
      { kind: "edge.added", at: AT, edgeId: "e" },
      { kind: "risk.added", at: AT, pairKey: "a|b", level: "high" },
      { kind: "validation.completed", at: AT, taskId: "n", passed: true }
    ];
    for (const e of noise) expect(adaptStreamEvent(e)).toEqual([]);
  });
});

describe("sse-adapter — planning.node.status fidelity (PR-N1)", () => {
  const status = (state: string, extra: Record<string, unknown> = {}): StreamEvent =>
    ({ kind: "planning.node.status", at: AT, nodeId: "n", title: "N", goal: "g", depth: 1, state, ...extra } as StreamEvent);

  it("12. retrying → plan.node.status carrying attempt/error telemetry (was collapsed by PR11)", () => {
    const mapped = adaptStreamEvent(status("retrying", { attempt: 1, maxAttempts: 3, durationMs: 1200, errorKind: "missing_json", errorMessage: "No JSON object found" }));
    expect(mapped).toHaveLength(1);
    expect(mapped[0]!.type).toBe("plan.node.status");
    expect(mapped[0]!.payload).toMatchObject({
      nodeId: "n",
      state: "retrying",
      attempt: 1,
      maxAttempts: 3,
      durationMs: 1200,
      errorKind: "missing_json",
      errorMessage: "No JSON object found"
    });
  });

  it("13. failed and fallback map 1:1 with their state", () => {
    expect(adaptStreamEvent(status("failed", { errorKind: "provider_timeout" }))[0]!.payload).toMatchObject({ state: "failed", errorKind: "provider_timeout" });
    expect(adaptStreamEvent(status("fallback", { attempt: 3 }))[0]!.payload).toMatchObject({ state: "fallback", attempt: 3 });
  });

  it("14. generated / complete normalize to generated (clears a prior retry)", () => {
    expect(adaptStreamEvent(status("generated"))[0]!.payload).toMatchObject({ state: "generated" });
    expect(adaptStreamEvent(status("complete"))[0]!.payload).toMatchObject({ state: "generated" });
  });

  it("15. transient lifecycle states (generating/active/pending) are dropped as noise", () => {
    for (const s of ["generating", "active", "pending"]) {
      expect(adaptStreamEvent(status(s))).toEqual([]);
    }
  });

  it("16. planning.node.started still maps to plan.node.proposed (no regression)", () => {
    const mapped = adaptStreamEvent({ kind: "planning.node.started", at: AT, nodeId: "n", parentId: "root", title: "N", goal: "g", depth: 1 });
    expect(mapped[0]!.type).toBe("plan.node.proposed");
  });
});

describe("sse-adapter — whole-history mapping", () => {
  it("7. assigns strictly increasing seq over the output and drops noise", () => {
    const envelope = adaptStreamHistory(HISTORY, "run-x");
    const types = envelope.map((e) => e.type);
    expect(types).toEqual([
      "plan.node.proposed",
      "plan.node.proposed",
      "plan.node.proposed",
      "decision.raised",
      "node.execution.started",
      "node.execution.started",
      "node.verify.passed",
      "node.execution.failed"
    ]);
    expect(envelope.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(envelope.every((e) => e.runId === "run-x")).toBe(true);
  });

  it("7b. is pure — does not mutate the input array", () => {
    const input = [...HISTORY];
    adaptStreamHistory(input, "run-x");
    expect(input).toEqual(HISTORY);
  });
});

describe("sse-adapter — round-trip (adapt → reduce → project)", () => {
  it("8. the live run renders through the new model: nodes present, A done, B failed", () => {
    const model = modelFromStream(HISTORY);
    expect([...model.nodes.keys()].sort()).toEqual(["n-a", "n-b", "root"]);
    expect(selectRenderableNodeState(model, "n-a").display).toBe("done");
    expect(selectRenderableNodeState(model, "n-b").display).toBe("failed");

    const view = selectWorkspaceView(model);
    expect(view.health).toBe("failing"); // a failed leaf
    expect(view.nodes.find((n) => n.id === "n-a")!.display).toBe("done");
    expect(view.nodes.find((n) => n.id === "n-b")!.display).toBe("failed");

    // Focus works over the bridged model too.
    const focus = buildFocusView(model, { kind: "node", id: "root" });
    expect(focus.kind).toBe("node");
    if (focus.kind === "node") expect(focus.role).toBe("root");
  });

  it("9. an approve_plan gate from gate.required surfaces in the decision channel", () => {
    // Reduce only through the gate (before any agent runs).
    const upToGate: StreamEvent[] = HISTORY.slice(0, HISTORY.findIndex((e) => e.kind === "gate.required") + 1);
    const channel = buildDecisionChannelView(modelFromStream(upToGate));
    expect(channel.empty).toBe(false);
    expect(channel.items.some((i) => i.kind === "approve_plan")).toBe(true);
  });

  it("10. a clarify question round-trips into a pending clarify decision", () => {
    const stream: StreamEvent[] = [
      { kind: "planning.node.started", at: AT, nodeId: "root", title: "R", goal: "g", depth: 0 },
      { kind: "planning.node.started", at: AT, nodeId: "n-x", parentId: "root", title: "X", goal: "g", depth: 1 },
      { kind: "planning.question", at: AT, nodeId: "n-x", question: "¿Formato?", options: ["CSV", "PDF"] }
    ];
    const model = modelFromStream(stream);
    const focus = buildFocusView(model, { kind: "decision", id: "clarify:n-x" });
    expect(focus.kind).toBe("decision");
    if (focus.kind === "decision") {
      expect(focus.decisionKind).toBe("clarify");
      expect(focus.status).toBe("pending");
      expect(focus.options).toEqual(["CSV", "PDF"]);
    }
  });

  it("11. reducing the bridged envelope never produces a stale-as-done node (invariant holds)", () => {
    const view = selectWorkspaceView(modelFromStream(HISTORY));
    for (const node of view.nodes) {
      if (node.freshness === "stale") expect(node.display).not.toBe("done");
    }
  });
});
