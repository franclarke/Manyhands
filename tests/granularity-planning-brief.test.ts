import { describe, expect, it } from "vitest";
import {
  PILOT_UTILITY_POLICY,
  buildGranularityPlanningBrief
} from "@manyhands/decomposer";
import { bookingSnapshot } from "./helpers/target-planning-fixtures";

describe("granularity planning brief", () => {
  it("places exact policy budgets and semantic hard gates before planning", () => {
    const brief = buildGranularityPlanningBrief({
      repositorySnapshot: bookingSnapshot(),
      config: PILOT_UTILITY_POLICY,
      candidateCount: 3
    });

    expect(brief).toMatchObject({
      schemaVersion: 1,
      policyVersion: PILOT_UTILITY_POLICY.policyVersion,
      candidateCount: 3,
      leafBudget: {
        maxContextTokens: 24_000,
        maxScopePaths: 40,
        maxPlannedPaths: 12
      },
      repositorySignals: {
        snapshotId: bookingSnapshot().snapshotId,
        inspectionDisposition: "complete",
        indexedPathCount: 4,
        baselineValidationKinds: ["test", "typecheck"]
      }
    });
    expect(brief.hardGates).toEqual([
      "acceptance_owner",
      "cross_leaf_materialization",
      "local_validation",
      "compiler_approvable"
    ]);
    expect(brief.acceptanceOwnership).toEqual({
      leaf: "Reference a local intent only from the leaf that can prove it.",
      seam: "Reference a seam intent from exactly its producer and consumers.",
      global: "Reference an integration intent only from its owning composite."
    });
  });
});
