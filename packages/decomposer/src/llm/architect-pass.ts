import {
  evaluateIntrinsicComplexity,
  type ComplexityDimensions,
  type GranularityAssessment
} from "../granularity/complexity-evaluator.js";
import type { ProposedGranularityUnit } from "../granularity/coalescing-critic.js";

export interface ArchitectTaskInput {
  nodeId: string;
  title: string;
  goal: string;
  targetScopePaths: string[];
  complexity: ComplexityDimensions;
  acceptanceIntentIds?: string[];
  expectedDependencies?: string[];
  proposedUnits?: ProposedGranularityUnit[];
  rationale?: string;
}

export interface ArchitectPassResult extends ArchitectTaskInput {
  assessment: GranularityAssessment;
}

/**
 * Deterministic boundary for the semantic Architect output. An LLM may produce
 * the signals and proposed units, but it cannot override the leaf threshold.
 */
export function runArchitectPass(input: ArchitectTaskInput): ArchitectPassResult {
  if (input.title.trim().length === 0 || input.goal.trim().length === 0) {
    throw new TypeError("Architect tasks require a non-empty title and goal.");
  }
  if (input.targetScopePaths.length === 0) {
    throw new TypeError(`Architect task ${input.nodeId} must declare targetScopePaths.`);
  }
  return {
    ...input,
    targetScopePaths: [...new Set(input.targetScopePaths)].sort(),
    assessment: evaluateIntrinsicComplexity({
      nodeId: input.nodeId,
      ...input.complexity,
      ...(input.rationale === undefined ? {} : { rationale: input.rationale })
    })
  };
}

export class ArchitectPass {
  assess(input: ArchitectTaskInput): ArchitectPassResult {
    return runArchitectPass(input);
  }
}
