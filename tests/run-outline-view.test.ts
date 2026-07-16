import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import { selectRunOutline } from "@/lib/run-model/run-outline-view";
import { goldenBehavioralConflict, goldenHappyPath } from "@/lib/run-model/fixtures";
import type { RunConfig, RunEvent, RunFixture, RunModel } from "@/lib/run-model/types";

const CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "m",
  executionSelection: { executorId: "e", model: "m" },
  repairSelection: { executorId: "e", model: "m" }
};

function at(fixture: RunFixture, predicate: (event: RunEvent) => boolean): RunModel {
  const seq = fixture.events.find(predicate)!.seq;
  return reduceRunEvents(
    createInitialRunModel({ id: fixture.runId, intent: "", workspaceId: "ws", config: CONFIG }),
    fixture.events.filter((event) => event.seq <= seq)
  );
}

describe("run outline view", () => {
  it("keeps running tasks and their real ancestors", () => {
    const model = at(goldenHappyPath, (event) => event.type === "node.execution.started" && event.payload.nodeId === "n-ui");
    const view = selectMinimalWorkspaceView(model);
    const outline = selectRunOutline(view, "running");
    const direct = outline.items.filter((item) => item.matchesFilter);

    expect(direct.map((item) => item.id)).toContain("n-ui");
    expect(outline.items.some((item) => item.role === "root")).toBe(true);
    expect(outline.items.every((item) => item.matchesFilter || item.hasMatchingDescendant)).toBe(true);
  });

  it("routes conflict, gated and failed work into needs-attention", () => {
    const model = at(
      goldenBehavioralConflict,
      (event) => event.type === "decision.raised" && event.payload.kind === "resolve_conflict"
    );
    const view = selectMinimalWorkspaceView(model);
    const outline = selectRunOutline(view, "attention");

    expect(outline.items.some((item) => item.matchesFilter && item.hasActiveConflict)).toBe(true);
    expect(outline.matchCount).toBeGreaterThan(0);
  });
});
