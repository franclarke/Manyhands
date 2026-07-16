import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectOperationalRecovery } from "@/lib/run-model/operational-recovery";
import type { Run, RunEvent } from "@/lib/run-model/types";

function seed(status: Run["control"]["status"]): Run {
  return {
    id: "run-recovery",
    intent: "Recover safely",
    workspaceId: "workspace",
    config: { aggressiveness: "medium", planningModel: "claude", executionSelection: { executorId: "claude-code-cli", model: "claude" }, repairSelection: { executorId: "claude-code-cli", model: "claude" } },
    control: { status, version: 1, pendingHumanAction: "none", updatedAt: "2026-07-12T00:00:00.000Z" }
  };
}

function event(type: RunEvent["type"], payload: Record<string, unknown>, seq = 1): RunEvent {
  return { seq, at: "2026-07-12T00:00:00.000Z", runId: "run-recovery", actor: "system", type, payload } as RunEvent;
}

describe("operational recovery selector", () => {
  it("explains a cancelling run with survivors and exposes only retry cancellation", () => {
    const events = [event("run.cancelled", { allDead: false, survivors: [42], killedProcesses: 0, escalatedKills: 0, cleanedWorktrees: [], gcFailures: [] })];
    const view = selectOperationalRecovery(reduceRunEvents(createInitialRunModel(seed("cancelling")), events), events);
    expect(view).toMatchObject({ state: "cancelling", canCancel: true, cancellation: { allDead: false, survivors: [42] } });
    expect(view.recommendedActions).toContain("retry_cancel");
  });

  it("keeps a pending decision gated and identifies the real human action", () => {
    const events = [event("decision.raised", { decisionId: "approve_plan", kind: "approve_plan", blocking: true, context: {} })];
    const view = selectOperationalRecovery(reduceRunEvents(createInitialRunModel(seed("paused")), events), events);
    expect(view.state).toBe("gated");
    expect(view.pendingDecisionIds).toEqual(["approve_plan"]);
    expect(view.recommendedActions).toContain("resolve_decision");
  });

  it("never presents partial, unverified, or degraded evidence as settled success", () => {
    const partial = selectOperationalRecovery(createInitialRunModel(seed("partial")), []);
    const unverified = selectOperationalRecovery(createInitialRunModel(seed("unverified")), []);
    const degradedEvents = [event("checkpoint.degraded", { reason: "trailing partial line" })];
    const degraded = selectOperationalRecovery(reduceRunEvents(createInitialRunModel(seed("completed")), degradedEvents), degradedEvents);
    expect(partial.state).toBe("partial");
    expect(unverified.state).toBe("unverified");
    expect(degraded.state).toBe("degraded");
  });

  it("prioritizes a durable terminal failure over an obsolete pending gate", () => {
    const events = [event("decision.raised", { decisionId: "approve_plan", kind: "approve_plan", blocking: true, context: {} })];
    const view = selectOperationalRecovery(reduceRunEvents(createInitialRunModel(seed("failed_artifact")), events), events);

    expect(view.state).toBe("failed");
    expect(view.canResolveDecision).toBe(false);
    expect(view.recommendedActions).not.toContain("resolve_decision");
  });

  it("uses the latest durable execution failure as the recovery cause", () => {
    const events = [event("node.execution.failed", { nodeId: "build-ui", cause: "La validación de tipos falló." })];
    const view = selectOperationalRecovery(reduceRunEvents(createInitialRunModel(seed("failed")), events), events);

    expect(view.failure).toEqual({ cause: "La validación de tipos falló.", nodeId: "build-ui", eventSeq: 1 });
  });
});
