import path from "node:path";
import { describe, expect, it } from "vitest";
import { batchHasHighOrBlockingRisk, runMockPlanningFlow } from "@manyhands/core";
import { InMemoryTraceStore } from "@manyhands/trace-store";

const fixturePath = path.resolve(process.cwd(), "examples/features/passwordless-login.json");

describe("mock planning flow", () => {
  it("generates a conflict risk matrix", async () => {
    const result = await runMockPlanningFlow({ fixturePath, mode: "balanced" });

    expect(result.riskMatrix.length).toBeGreaterThan(0);
    expect(result.summary.riskPredictionCount).toBe(result.riskMatrix.length);
  });

  it("generates risk-aware batches without high-risk pairs in the same batch", async () => {
    const result = await runMockPlanningFlow({ fixturePath, mode: "balanced", maxParallel: 3 });

    for (const batch of result.schedule.batches) {
      expect(batchHasHighOrBlockingRisk(batch, result.riskMatrix)).toBe(false);
    }
  });

  it("registers planning events in InMemoryTraceStore", async () => {
    const traceStore = new InMemoryTraceStore();
    const result = await runMockPlanningFlow({ fixturePath, mode: "balanced", traceStore });
    const eventTypes = result.traces.map((event) => event.type);

    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "feature_loaded",
        "decomposition_started",
        "graph_created",
        "contract_created",
        "graph_validated",
        "contract_validated",
        "risk_predicted",
        "batch_scheduled",
        "planning_run_completed"
      ])
    );
    expect(traceStore.list()).toHaveLength(result.summary.traceEventCount);
  });

  it("returns a summary with basic planning metrics", async () => {
    const result = await runMockPlanningFlow({ fixturePath, mode: "balanced" });

    expect(result.summary).toEqual(
      expect.objectContaining({
        taskCount: 11,
        leafCount: 7,
        contractCount: 7,
        batchCount: result.schedule.batches.length,
        traceEventCount: result.traces.length
      })
    );
    expect(result.summary.validationIssues).toEqual([]);
  });
});
