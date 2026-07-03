/**
 * PR-N1 — Planning observability / bridge fidelity (pure, node environment).
 *
 * The recursive decomposer already produces robust graph-generation telemetry
 * (retry/backoff/fallback/timeout, classified errors). This proves the agent-first
 * model now CARRIES it as an orthogonal axis (`plan.node.status` → `node.planning`)
 * and DERIVES it (`selectPlanningHealth`) without:
 *  - touching a node's execution/display (a fallback node is a normal proposed leaf),
 *  - routing autonomous retries into the human decision channel / attention.
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvent, reduceRunEvents } from "@/lib/run-model/reducer";
import {
  selectAttention,
  selectNodePlanning,
  selectPlanningHealth,
  selectRenderableNodeState
} from "@/lib/run-model/selectors";
import { buildDecisionChannelView } from "@/lib/run-model/decision-channel-view";
import { buildFocusView } from "@/lib/run-model/focus-view";
import { adaptStreamHistory } from "@/lib/run-model/sse-adapter";
import { goldenPlanningFallback } from "@/lib/run-model/fixtures";
import type { StreamEvent } from "@/lib/server/runs/events";
import type { RunConfig, RunEvent, RunModel } from "@/lib/run-model/types";

const STUB_CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "m",
  executionSelection: { executorId: "e", model: "m" },
  repairSelection: { executorId: "e", model: "m" }
};

function emptyModel(runId = "run-x"): RunModel {
  return createInitialRunModel({ id: runId, intent: "", workspaceId: "ws", config: STUB_CONFIG });
}

function ev(seq: number, type: string, payload: Record<string, unknown>): RunEvent {
  return { seq, at: `2026-06-06T00:00:0${seq}.000Z`, runId: "run-x", actor: "system", type, payload };
}

const fixtureModel: RunModel = reduceRunEvents(emptyModel(goldenPlanningFallback.runId), goldenPlanningFallback.events);

describe("planning-health — reducer records the orthogonal planning axis", () => {
  it("1. plan.node.status sets node.planning without ever touching execution", () => {
    const model = reduceRunEvents(emptyModel(), [
      ev(1, "plan.node.proposed", { nodeId: "n", parentId: null, role: "leaf", title: "N", goal: "g", depth: 0 }),
      ev(2, "plan.node.status", { nodeId: "n", state: "fallback", attempt: 3, maxAttempts: 3, errorKind: "schema_invalid" })
    ]);
    const node = model.nodes.get("n")!;
    expect(node.planning).toMatchObject({ state: "fallback", attempt: 3, maxAttempts: 3, errorKind: "schema_invalid" });
    expect(node.execution).toEqual({ kind: "idle" }); // untouched
  });

  it("2. a later plan.node.proposed (re-propose) preserves the recorded planning", () => {
    const model = reduceRunEvents(emptyModel(), [
      ev(1, "plan.node.proposed", { nodeId: "n", parentId: null, role: "leaf", title: "N", goal: "g", depth: 0 }),
      ev(2, "plan.node.status", { nodeId: "n", state: "retrying", attempt: 1 }),
      ev(3, "plan.node.proposed", { nodeId: "n", parentId: null, role: "leaf", title: "N2", goal: "g2", depth: 0 })
    ]);
    expect(model.nodes.get("n")!.planning?.state).toBe("retrying");
    expect(model.nodes.get("n")!.title).toBe("N2");
  });

  it("3. a recovery status overwrites a prior concern (retrying → generated)", () => {
    let model = reduceRunEvent(emptyModel(), ev(1, "plan.node.proposed", { nodeId: "n", parentId: null, role: "leaf", title: "N", goal: "g", depth: 0 }));
    model = reduceRunEvent(model, ev(2, "plan.node.status", { nodeId: "n", state: "retrying", attempt: 1 }));
    model = reduceRunEvent(model, ev(3, "plan.node.status", { nodeId: "n", state: "generated", attempt: 2 }));
    expect(model.nodes.get("n")!.planning?.state).toBe("generated");
  });
});

describe("planning-health — selector derives, never gates", () => {
  it("4. selectPlanningHealth reports fallback; a recovered retry is clean", () => {
    const health = selectPlanningHealth(fixtureModel);
    expect(health.fallback).toEqual(["n-eval"]);
    expect(health.retrying).toEqual([]); // n-parse recovered to generated
    expect(health.failed).toEqual([]);
    expect(health.clean).toBe(false);
  });

  it("5. a run with no planning concerns is clean", () => {
    const model = reduceRunEvents(emptyModel(), [
      ev(1, "plan.node.proposed", { nodeId: "n", parentId: null, role: "leaf", title: "N", goal: "g", depth: 0 })
    ]);
    expect(selectPlanningHealth(model)).toEqual({ retrying: [], fallback: [], failed: [], clean: true });
  });

  it("6. selectNodePlanning returns the recorded status or null", () => {
    expect(selectNodePlanning(fixtureModel, "n-eval")?.state).toBe("fallback");
    expect(selectNodePlanning(fixtureModel, "root")).toBeNull();
  });
});

describe("planning-health — orthogonality invariants", () => {
  it("7. a fallback node is a normal proposed leaf (display idle, never failed/done)", () => {
    const render = selectRenderableNodeState(fixtureModel, "n-eval");
    expect(render.display).toBe("idle");
    expect(render.display).not.toBe("failed");
    expect(render.display).not.toBe("done");
  });

  it("8. autonomous planning retries/fallback NEVER enter the decision channel", () => {
    const channel = buildDecisionChannelView(fixtureModel);
    // The only gate is the approve_plan; no planning concern is a decision.
    expect(channel.items.every((i) => i.kind === "approve_plan")).toBe(true);
  });

  it("9. planning concerns NEVER raise human attention", () => {
    const attention = selectAttention(fixtureModel);
    expect(attention.every((d) => d.kind === "approve_plan")).toBe(true);
  });

  it("10. the focus view surfaces planning telemetry on the node", () => {
    const focus = buildFocusView(fixtureModel, { kind: "node", id: "n-eval" });
    expect(focus.kind).toBe("node");
    if (focus.kind === "node") expect(focus.planning?.state).toBe("fallback");
  });
});

describe("planning-health — SSE bridge round-trip", () => {
  it("11. a legacy retry→recovery stream round-trips to a clean planning axis", () => {
    const stream: StreamEvent[] = [
      { kind: "planning.node.started", at: "t", nodeId: "n", parentId: "root", title: "N", goal: "g", depth: 1 },
      { kind: "planning.node.status", at: "t", nodeId: "n", title: "N", goal: "g", depth: 1, state: "retrying", attempt: 1, maxAttempts: 3, errorKind: "missing_json" },
      { kind: "planning.node.status", at: "t", nodeId: "n", title: "N", goal: "g", depth: 1, state: "generated", attempt: 2 }
    ];
    const model = reduceRunEvents(emptyModel(), adaptStreamHistory(stream, "run-x"));
    expect(model.nodes.get("n")!.planning?.state).toBe("generated");
    expect(selectPlanningHealth(model).clean).toBe(true);
  });

  it("12. a legacy fallback stream round-trips to a flagged-but-usable node", () => {
    const stream: StreamEvent[] = [
      { kind: "planning.node.started", at: "t", nodeId: "n", parentId: "root", title: "N", goal: "g", depth: 1 },
      { kind: "planning.node.status", at: "t", nodeId: "n", title: "N", goal: "g", depth: 1, state: "fallback", attempt: 3, maxAttempts: 3, errorKind: "schema_invalid" }
    ];
    const model = reduceRunEvents(emptyModel(), adaptStreamHistory(stream, "run-x"));
    expect(selectPlanningHealth(model).fallback).toEqual(["n"]);
    expect(selectRenderableNodeState(model, "n").display).toBe("idle"); // still a usable proposed leaf
  });
});
