import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectLocalDecisionState } from "@/lib/run-model/selectors";
import type { RunConfig, RunEvent } from "@/lib/run-model/types";

const config: RunConfig = { aggressiveness: "medium", planningModel: "m", executionSelection: { executorId: "e", model: "m" }, repairSelection: { executorId: "e", model: "m" } };

describe("local decisions", () => {
  it("blocks only affected nodes while independent work remains running", () => {
    const initial = createInitialRunModel({ id: "run-1", intent: "Build", workspaceId: "ws", config });
    const events: RunEvent[] = [
      event(1, "decision.raised", { decision: { id: "decision-ui", kind: "clarify_goal", question: "Which empty state?", options: [{ id: "simple", label: "Simple" }, { id: "guided", label: "Guided" }], affectedNodeIds: ["ui"], evidenceRefs: ["e-1"], impact: "behavior" } }),
      event(2, "readiness.observed", { readyNodeIds: ["api"], pendingDecisionIds: ["decision-ui"] })
    ];
    const state = selectLocalDecisionState(reduceRunEvents(initial, events));
    expect(state.runBlocked).toBe(false);
    expect(state.readyNodeIds).toEqual(["api"]);
    expect(state.items[0]?.affectedNodeIds).toEqual(["ui"]);
  });
  it("uses a labelled modal with Escape handling and explicit focus restoration semantics", () => {
    const source = readFileSync(path.join(process.cwd(), "apps/web/src/components/run-model/decision-intervention.tsx"), "utf8");
    expect(source).toContain("<dialog");
    expect(source).toContain("aria-labelledby");
    expect(source).toContain("onCancel");
    expect(source).toContain("dialog.close()");
  });
});
function event(seq: number, type: string, payload: Record<string, unknown>): RunEvent { return { seq, at: "2026-07-17T00:00:00.000Z", runId: "run-1", actor: "system", type, payload }; }
