import { describe, expect, it } from "vitest";
import { PlanningModule, type GranularityPlanningBrief } from "@manyhands/decomposer";

/**
 * The productive planning model is `invokeSelectedPlanningCli`, which resolves
 * the CLI response as a STRING. Every executor — Codex and Claude Code alike —
 * reaches PlanningModule that way, so a string response is the shape that must
 * work, not an edge case.
 */
function brief(): GranularityPlanningBrief {
  return {
    schemaVersion: 1,
    policyVersion: "adaptive-utility/3.1.0-pilot",
    candidateCount: 2,
    leafBudget: { maxContextTokens: 60_000, maxScopePaths: 8, maxPlannedPaths: 12 },
    acceptanceOwnership: { leaf: "local", seam: "seam", global: "root" },
    hardGates: ["acceptance_owner", "cross_leaf_materialization", "local_validation", "compiler_approvable"],
    repositorySignals: {
      snapshotId: "snapshot-1",
      inspectionDisposition: "complete",
      indexedPathCount: 6,
      baselineValidationKinds: ["test"]
    }
  };
}

function request() {
  return {
    goal: "Record backorders across the domain",
    repositorySnapshot: {
      snapshotId: "snapshot-1",
      inspectionDisposition: "complete" as const,
      evidence: []
    },
    granularityBrief: brief(),
    candidateCount: 1
  };
}

function draft(): unknown {
  return {
    root: {
      key: "domain-backorders",
      kind: "leaf",
      title: "Record backorders in the domain",
      objective: "Record a positive backorder instead of rejecting the order",
      concerns: ["domain"],
      evidenceIds: [],
      plannedPaths: ["src/domain/orders.mjs"],
      outcomes: [
        {
          id: "outcome-backorder",
          description: "An order beyond available stock records a positive backorder",
          criterionIds: ["criterion-1"],
          verification: { kind: "author_test", references: ["src/domain/orders.test.mjs"] }
        }
      ]
    },
    seams: [],
    repositoryEvidence: [],
    uncertainties: [],
    questions: []
  };
}

describe("PlanningModule with the productive CLI response shape", () => {
  it("plans from a JSON string response", async () => {
    const module = new PlanningModule({
      model: { generate: async () => JSON.stringify(draft()) },
      maxAttempts: 1,
      retryDelayMs: 0
    });

    const outcome = await module.plan(request());

    expect(outcome.kind).toBe("ready");
  });

  it("reports the schema failure, not an iteration failure, for an invalid JSON string", async () => {
    const module = new PlanningModule({
      model: { generate: async () => JSON.stringify({ unexpected: true }) },
      maxAttempts: 1,
      retryDelayMs: 0
    });

    const outcome = await module.plan(request());

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") return;
    expect(outcome.error.message).not.toContain("is not iterable");
  });

  it("still plans when the response is already an array of objects", async () => {
    const module = new PlanningModule({
      model: { generate: async () => [draft()] },
      maxAttempts: 1,
      retryDelayMs: 0
    });

    const outcome = await module.plan(request());

    expect(outcome.kind).toBe("ready");
  });
});
