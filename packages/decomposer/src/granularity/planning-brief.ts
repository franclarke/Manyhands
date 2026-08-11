import type { RepositorySnapshot } from "@manyhands/repository-index";
import {
  type GranularityPolicyConfig,
  validateGranularityPolicyConfig
} from "./granularity-policy.js";

export const GRANULARITY_PLANNING_BRIEF_VERSION = 1 as const;

export const GRANULARITY_HARD_GATES = [
  "acceptance_owner",
  "cross_leaf_materialization",
  "local_validation",
  "compiler_approvable"
] as const;

export interface GranularityPlanningBrief {
  schemaVersion: typeof GRANULARITY_PLANNING_BRIEF_VERSION;
  policyVersion: string;
  candidateCount: number;
  leafBudget: {
    maxContextTokens: number;
    maxScopePaths: number;
    maxPlannedPaths: number;
  };
  acceptanceOwnership: {
    leaf: string;
    seam: string;
    global: string;
  };
  hardGates: Array<typeof GRANULARITY_HARD_GATES[number]>;
  repositorySignals: {
    snapshotId: string;
    inspectionDisposition: RepositorySnapshot["inspectionDisposition"];
    indexedPathCount: number;
    baselineValidationKinds: string[];
  };
}

export function buildGranularityPlanningBrief(input: {
  repositorySnapshot: RepositorySnapshot;
  config: GranularityPolicyConfig;
  candidateCount?: number;
}): GranularityPlanningBrief {
  const config = validateGranularityPolicyConfig(input.config);
  const candidateCount = input.candidateCount ?? 3;
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 2 || candidateCount > 3) {
    throw new RangeError("candidateCount must be an integer between 2 and 3.");
  }

  return {
    schemaVersion: GRANULARITY_PLANNING_BRIEF_VERSION,
    policyVersion: config.policyVersion,
    candidateCount,
    leafBudget: {
      maxContextTokens: config.maxLeafContextTokens,
      maxScopePaths: config.maxLeafScopePaths,
      maxPlannedPaths: config.maxLeafPlannedPaths
    },
    acceptanceOwnership: {
      leaf: "Reference a local intent only from the leaf that can prove it.",
      seam: "Reference a seam intent from exactly its producer and consumers.",
      global: "Reference an integration intent only from its owning composite."
    },
    hardGates: [...GRANULARITY_HARD_GATES],
    repositorySignals: {
      snapshotId: input.repositorySnapshot.snapshotId,
      inspectionDisposition: input.repositorySnapshot.inspectionDisposition,
      indexedPathCount: input.repositorySnapshot.index?.files.length ?? 0,
      baselineValidationKinds: [...new Set(
        input.repositorySnapshot.capabilities.baselineCommands.map((command) => command.kind)
      )]
    }
  };
}
