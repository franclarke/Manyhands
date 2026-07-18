/**
 * G-1 — Live run → run-model bridge (pure core, node environment).
 *
 * `buildLiveRunModel` is the pure heart of the gated real-run path: it takes the
 * native SSE history (`RunEvent[]`) + a run seed and produces the reduced
 * `RunModel` the agent-first surface renders. The browser hook is thin wiring
 * over this; here we prove the core renders a real-shaped run and stays
 * monotonic as the stream grows.
 */
import { describe, expect, it } from "vitest";
import { buildLiveRunModel, hasRunEventGap, isTerminalRunStatus } from "@/components/run-model/use-live-run-model";
import { selectRenderableNodeState } from "@/lib/run-model/selectors";
import { buildDecisionChannelView } from "@/lib/run-model/decision-channel-view";
import type { Run, RunEvent } from "@/lib/run-model/types";

const SEED: Run = {
  id: "run-live",
  intent: "Feature de prueba",
  workspaceId: "ws",
  config: {
    aggressiveness: "medium",
    planningModel: "sonnet",
    executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
    repairSelection: { executorId: "claude-code-cli", model: "sonnet" }
  },
  control: {
    status: "created",
    version: 0,
    pendingHumanAction: "none",
    updatedAt: "2026-06-06T00:00:00.000Z"
  }
};

const AT = "2026-06-06T00:00:00.000Z";

// A realistic legacy run stream: status churn, planning, gate, two leaves (one
// passes, one fails), plus replay/heartbeat noise the adapter must drop.
function event(seq: number, type: string, payload: Record<string, unknown>, actor: RunEvent["actor"] = "system"): RunEvent {
  return { eventId: `event-${seq}`, seq, at: AT, runId: SEED.id, actor, type, payload };
}

const STREAM: RunEvent[] = [
  event(1, "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Root", goal: "coord", depth: 0 }),
  event(2, "plan.node.proposed", { nodeId: "n-a", parentId: "root", role: "leaf", title: "A", goal: "do a", depth: 1 }),
  event(3, "plan.node.proposed", { nodeId: "n-b", parentId: "root", role: "leaf", title: "B", goal: "do b", depth: 1 }),
  event(4, "decision.raised", { decisionId: "approve_plan", kind: "approve_plan", blocking: true, context: { nodeIds: ["n-a", "n-b"] } }),
  event(5, "node.execution.started", { nodeId: "n-a", agent: "agent", model: "m" }, "agent"),
  event(6, "node.execution.started", { nodeId: "n-b", agent: "agent", model: "m" }, "agent"),
  event(7, "node.verify.passed", { nodeId: "n-a", commit: "a", changedFiles: [], builtAgainst: [] }, "agent"),
  event(8, "node.execution.failed", { nodeId: "n-b", cause: "failed" }, "agent")
];

describe("live bridge — buildLiveRunModel", () => {
  it("1. seeds run identity/config and renders the real run through the model", () => {
    const { model } = buildLiveRunModel(STREAM, SEED);
    expect(model.run.id).toBe("run-live");
    expect(model.run.intent).toBe("Feature de prueba");
    expect([...model.nodes.keys()].sort()).toEqual(["n-a", "n-b", "root"]);
    expect(selectRenderableNodeState(model, "n-a").display).toBe("done");
    expect(selectRenderableNodeState(model, "n-b").display).toBe("failed");
  });

  it("2. preserves the ordered canonical envelope", () => {
    const { events } = buildLiveRunModel(STREAM, SEED);
    expect(events.some((e) => e.type === "plan.node.proposed")).toBe(true);
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b));
  });

  it("3. the approve_plan gate surfaces in the decision channel", () => {
    const upToGate = STREAM.slice(0, STREAM.findIndex((event) => event.type === "decision.raised") + 1);
    const { model } = buildLiveRunModel(upToGate, SEED);
    const channel = buildDecisionChannelView(model);
    expect(channel.items.some((i) => i.kind === "approve_plan")).toBe(true);
  });

  it("4. recompute-from-scratch is monotonic: a prefix is a sub-state of the full run", () => {
    const prefix = STREAM.slice(0, STREAM.findIndex((e) => e.type === "node.verify.passed"));
    const partial = buildLiveRunModel(prefix, SEED).model;
    const full = buildLiveRunModel(STREAM, SEED).model;
    // n-a is still running in the prefix, done in the full run — never regresses.
    expect(selectRenderableNodeState(partial, "n-a").display).toBe("running");
    expect(selectRenderableNodeState(full, "n-a").display).toBe("done");
    expect(full.cursor).toBeGreaterThan(partial.cursor);
  });

  it("5. combines persisted baseline events with live SSE without seq collisions", () => {
    const initialEvents: RunEvent[] = [
      {
        seq: 1,
        at: AT,
        runId: SEED.id,
        actor: "system",
        type: "plan.node.proposed",
        payload: { nodeId: "root", parentId: null, role: "root", title: "Root", goal: "coord", depth: 0 }
      }
    ];
    const live: RunEvent[] = [
      {
        seq: 1,
        at: AT,
        runId: SEED.id,
        actor: "system",
        type: "plan.node.proposed",
        payload: { nodeId: "root", parentId: null, role: "root", title: "Root duplicate", goal: "coord", depth: 0 }
      },
      {
        seq: 2,
        at: AT,
        runId: SEED.id,
        actor: "system",
        type: "decision.raised",
        payload: { decisionId: "approve_plan", kind: "approve_plan", blocking: true, context: { nodeIds: ["root"] } }
      },
      {
        seq: 3,
        at: AT,
        runId: SEED.id,
        actor: "human",
        type: "decision.resolved",
        payload: { decisionId: "approve_plan", choice: { action: "approve" }, actor: "human" }
      }
    ];
    const { model, events } = buildLiveRunModel(live, SEED, initialEvents);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(model.nodes.has("root")).toBe(true);
    expect(model.decisions.get("approve_plan")?.status).toBe("resolved");
    expect(buildDecisionChannelView(model).empty).toBe(true);
  });

  it("6. detects a first live-frame gap relative to the hydrated cursor", () => {
    expect(hasRunEventGap(5, 7, false)).toBe(true);
    expect(hasRunEventGap(5, 6, false)).toBe(false);
    expect(hasRunEventGap(5, 9, true)).toBe(false);
  });

  it("7. treats terminal historical runs as already connected for UI liveness", () => {
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("completed_with_accepted")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("interrupted")).toBe(true);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("paused")).toBe(false);
  });
});
