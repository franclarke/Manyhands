/**
 * U-A — Reconciliation & Disposition depth (pure, node environment).
 *
 * Proves the agent-first model now CARRIES the run's GranularityVector
 * (run.metrics.ready → model.metrics) and DERIVES per-composite integration
 * progress (selectIntegrationProgress) from existing node state — no new backend
 * event. Both surface in the workspace/evidence view-models, fixture-first.
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectGranularityMetrics, selectIntegrationProgress } from "@/lib/run-model/selectors";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
import { buildFocusView } from "@/lib/run-model/focus-view";
import { goldenHappyPath, goldenPlanningFallback } from "@/lib/run-model/fixtures";
import type { GranularityMetrics, RunConfig, RunEvent, RunModel } from "@/lib/run-model/types";

const STUB_CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "m",
  executionSelection: { executorId: "e", model: "m" },
  repairSelection: { executorId: "e", model: "m" }
};

function emptyModel(runId = "run-x"): RunModel {
  return createInitialRunModel({ id: runId, intent: "", workspaceId: "ws", config: STUB_CONFIG });
}

function ev(seq: number, actor: RunEvent["actor"], type: string, payload: Record<string, unknown>): RunEvent {
  return { seq, at: `2026-06-06T00:00:${String(seq).padStart(2, "0")}.000Z`, runId: "run-x", actor, type, payload };
}

const METRICS: GranularityMetrics = {
  depth: 2,
  leafCount: 4,
  compositeCount: 2,
  avgLeafDepth: 1.5,
  maxLeafDepth: 2,
  dependencyCount: 1,
  avgAcceptanceCriteriaPerLeaf: 2,
  integrationSuccessRate: 1,
  leafSuccessRate: 0.75,
  conflictRate: 0,
  totalDurationMs: 30000,
  linesChanged: 88,
  unexpectedCommitCount: 0,
  scopeViolationCount: 0
};

const happyModel: RunModel = reduceRunEvents(emptyModel(goldenHappyPath.runId), goldenHappyPath.events);

describe("disposition — granularity metrics", () => {
  it("1. run.metrics.ready stores model.metrics; selectGranularityMetrics passes it through", () => {
    const model = reduceRunEvents(emptyModel(), [ev(1, "system", "run.metrics.ready", { metrics: METRICS })]);
    expect(model.metrics).toEqual(METRICS);
    expect(selectGranularityMetrics(model)).toEqual(METRICS);
  });

  it("2. metrics is null until run.metrics.ready", () => {
    expect(selectGranularityMetrics(emptyModel())).toBeNull();
  });

  it("3. golden-happy-path carries the metrics through the full fold", () => {
    const m = selectGranularityMetrics(happyModel);
    expect(m).not.toBeNull();
    expect(m!.leafCount).toBe(3);
    expect(m!.leafSuccessRate).toBe(1);
    expect(m!.totalCostUsd).toBe(0.12);
  });

  it("4. the evidence focus surfaces the metrics", () => {
    const focus = buildFocusView(happyModel, { kind: "evidence", id: "final" });
    expect(focus.kind).toBe("evidence");
    if (focus.kind === "evidence") expect(focus.metrics?.leafCount).toBe(3);
  });

  it("5. the workspace view exposes metrics and emphasizes them at disposition", () => {
    const view = selectWorkspaceView(happyModel);
    expect(view.metrics).not.toBeNull();
    expect(view.emphasis.showMetrics).toBe(true);
  });
});

describe("disposition — integration progress (reconciliation, derived)", () => {
  it("6. an integrated composite reports integrated with all children done", () => {
    const progress = selectIntegrationProgress(happyModel);
    const root = progress.find((p) => p.id === "root")!;
    expect(root.state).toBe("integrated");
    expect(root.doneChildCount).toBe(root.totalChildCount);
    expect(root.totalChildCount).toBe(3);
  });

  it("7. all children integrated but composite not yet → ready", () => {
    const model = reduceRunEvents(emptyModel(), [
      ev(1, "system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "R", goal: "g", depth: 0 }),
      ev(2, "system", "plan.node.proposed", { nodeId: "a", parentId: "root", role: "leaf", title: "A", goal: "g", depth: 1 }),
      ev(3, "system", "plan.node.proposed", { nodeId: "b", parentId: "root", role: "leaf", title: "B", goal: "g", depth: 1 }),
      ev(4, "agent", "node.verify.passed", { nodeId: "a", commit: "a1", changedFiles: [], builtAgainst: [] }),
      ev(5, "agent", "node.verify.passed", { nodeId: "b", commit: "b1", changedFiles: [], builtAgainst: [] })
    ]);
    const root = selectIntegrationProgress(model).find((p) => p.id === "root")!;
    expect(root.state).toBe("ready");
    expect(root.doneChildCount).toBe(2);
  });

  it("8. a failed composite reports failed", () => {
    const model = reduceRunEvents(emptyModel(), [
      ev(1, "system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "R", goal: "g", depth: 0 }),
      ev(2, "system", "plan.node.proposed", { nodeId: "a", parentId: "root", role: "leaf", title: "A", goal: "g", depth: 1 }),
      ev(3, "system", "integration.completed", { compositeNodeId: "root", commit: "", status: "failed" })
    ]);
    expect(selectIntegrationProgress(model).find((p) => p.id === "root")!.state).toBe("failed");
  });

  it("9. a composite whose children are still idle → pending (golden-planning-fallback)", () => {
    const model = reduceRunEvents(emptyModel(goldenPlanningFallback.runId), goldenPlanningFallback.events);
    const root = selectIntegrationProgress(model).find((p) => p.id === "root")!;
    expect(root.state).toBe("pending");
    expect(root.doneChildCount).toBe(0);
  });

  it("10. selectIntegrationProgress is pure (stable across calls, no mutation)", () => {
    const before = happyModel.nodes.size;
    const a = selectIntegrationProgress(happyModel);
    const b = selectIntegrationProgress(happyModel);
    expect(a).toEqual(b);
    expect(happyModel.nodes.size).toBe(before);
  });
});
