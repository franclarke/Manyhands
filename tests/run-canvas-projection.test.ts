import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import { selectRunCanvasProjection } from "@/lib/run-model/run-canvas-projection";
import { goldenHappyPath } from "@/lib/run-model/fixtures";
import type { RunConfig, RunEvent, RunModel } from "@/lib/run-model/types";

const CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "planning",
  executionSelection: { executorId: "claude", model: "sonnet" },
  repairSelection: { executorId: "claude", model: "sonnet" }
};

function completedModel(): RunModel {
  const initial = createInitialRunModel({
    id: goldenHappyPath.runId,
    intent: "Build a counter",
    workspaceId: "ws",
    config: CONFIG
  });
  return reduceRunEvents(initial, goldenHappyPath.events);
}

function withSchedulingWave(model: RunModel): RunModel {
  const event: RunEvent = {
    seq: model.cursor + 1,
    at: "2026-07-14T12:00:00.000Z",
    runId: model.run.id,
    actor: "system",
    type: "run.scheduling.wave_selected",
    payload: {
      version: 1,
      waveId: "wave-3",
      waveIndex: 3,
      source: "execution-host",
      maxParallel: 6,
      routing: "fixed",
      policy: "risk_aware",
      readyTaskIds: ["n-store", "n-ui", "n-logic"],
      selectedTaskIds: ["n-store", "n-ui"],
      blockedTaskIds: ["n-logic"],
      blockedReasons: [{ taskId: "n-logic", reason: "src/store.ts", relatedTaskIds: ["n-store"] }],
      riskSummary: { safe: 1, elevated: 0, blocking: 1 },
      fallbacks: [],
      warnings: []
    }
  };
  return reduceRunEvents(model, [event]);
}

function withDistinctCanonicalEdges(model: RunModel): RunModel {
  const base = model.cursor;
  return reduceRunEvents(model, [
    {
      seq: base + 1,
      at: "2026-07-14T12:01:00.000Z",
      runId: model.run.id,
      actor: "system",
      type: "plan.dependency.proposed",
      payload: {
        fromTaskId: "n-logic",
        toTaskId: "n-ui",
        type: "logical",
        inferred: false,
        rationale: "UI must observe the finalized counter rules"
      }
    },
    {
      seq: base + 2,
      at: "2026-07-14T12:01:01.000Z",
      runId: model.run.id,
      actor: "system",
      type: "conflict.detected",
      payload: {
        conflictId: "conflict-counter",
        dimension: "behavioral",
        status: "detected",
        nodeIds: ["n-store", "n-ui"],
        files: ["src/counter.ts"],
        autoResolvable: false,
        diagnosisRef: "blob://counter-conflict"
      }
    }
  ]);
}

describe("run canvas projection", () => {
  it("keeps scheduling as an overlay over the unchanged task DAG", () => {
    const model = withSchedulingWave(completedModel());
    const view = selectMinimalWorkspaceView(model);
    const tasks = selectRunCanvasProjection(model, view, "tasks");
    const scheduling = selectRunCanvasProjection(model, view, "scheduling");

    expect(scheduling.graph.nodes.map((node) => node.id)).toEqual(tasks.graph.nodes.map((node) => node.id));
    expect(scheduling.graph.edges.map((edge) => edge.id)).toEqual(tasks.graph.edges.map((edge) => edge.id));
    expect(scheduling.overlayNodeIds).toEqual(["n-store", "n-ui"]);
    expect(scheduling.wave?.label).toBe("W1");
    expect(scheduling.wave?.policy).toBe("risk_aware");
    expect(scheduling.wave?.serialized).toEqual([
      { taskId: "n-logic", reason: "src/store.ts" }
    ]);
  });

  it("uses projections to change emphasis without filtering structural nodes", () => {
    const model = withDistinctCanonicalEdges(completedModel());
    const view = selectMinimalWorkspaceView(model);
    const tasks = selectRunCanvasProjection(model, view, "tasks");
    const integration = selectRunCanvasProjection(model, view, "integration");
    const interfaces = selectRunCanvasProjection(model, view, "interfaces");

    expect(integration.graph.nodes).toHaveLength(tasks.graph.nodes.length);
    expect(interfaces.graph.nodes).toHaveLength(tasks.graph.nodes.length);
    expect(integration.overlayNodeIds).toEqual(
      expect.arrayContaining(view.details.nodes.filter((node) => node.role !== "leaf").map((node) => node.id))
    );
    expect(tasks.showDependencyEdges).toBe(true);
    expect(tasks.showSeamEdges).toBe(false);
    expect(selectRunCanvasProjection(model, view, "scheduling").showDependencyEdges).toBe(true);
    expect(interfaces.showDependencyEdges).toBe(false);
    expect(interfaces.showSeamEdges).toBe(true);
    expect(integration.showConflictEdges).toBe(true);
    expect(interfaces.showHierarchyEdges).toBe(true);
  });

  it("keeps D1 dependencies, seams and conflicts as separate durable edge kinds", () => {
    const model = withDistinctCanonicalEdges(completedModel());
    const view = selectMinimalWorkspaceView(model);

    expect(view.graph.edges.filter((edge) => edge.kind === "dependency")).toEqual([{
      id: "d:n-logic:n-ui",
      source: "n-logic",
      target: "n-ui",
      kind: "dependency",
      dependencyType: "logical",
      inferred: false,
      rationale: "UI must observe the finalized counter rules"
    }]);
    expect(view.graph.edges).toContainEqual({
      id: "s:seam-counter:n-store:n-ui",
      source: "n-store",
      target: "n-ui",
      kind: "seam",
      seamId: "seam-counter"
    });
    expect(view.graph.edges).toContainEqual({
      id: "c:conflict-counter:n-store:n-ui",
      source: "n-store",
      target: "n-ui",
      kind: "conflict",
      conflictId: "conflict-counter"
    });
  });
});
