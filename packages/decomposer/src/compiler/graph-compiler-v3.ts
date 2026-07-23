import type { WorkUnit } from "../planner/schema.js";
import {
  reviewGranularityProposal,
  type GranularityCriticDecision,
  type ProposedGranularityUnit
} from "../granularity/coalescing-critic.js";
import type { GranularityAssessment } from "../granularity/complexity-evaluator.js";
import { runArchitectPass, type ArchitectTaskInput } from "../llm/architect-pass.js";

export interface AdaptiveWorkUnitCompilation {
  /** Canonical semantic planner tree consumed by the existing Graph Compiler. */
  root: WorkUnit;
  units: WorkUnit[];
  assessments: Record<string, GranularityAssessment>;
  coalescedUnitsCount: number;
  /** Merged unit key → the source unit keys it coalesced (provenance). */
  mergedFrom: Record<string, string[]>;
  /** Critic decisions recorded while reshaping (coalescence / re-splits). */
  criticDecisions: GranularityCriticDecision[];
}

const MAX_COMPILER_DEPTH = 8;
const DEFAULT_ACCEPTANCE_INTENT_ID = "adaptive-goal";

/**
 * Applies adaptive granularity before graph compilation. It deliberately emits
 * the canonical WorkUnit tree instead of introducing another graph model.
 */
export function compileAdaptiveWorkUnitTree(input: ArchitectTaskInput): AdaptiveWorkUnitCompilation {
  const units: WorkUnit[] = [];
  const assessments: Record<string, GranularityAssessment> = {};
  const seenIds = new Set<string>();
  const acceptanceIntentIds = input.acceptanceIntentIds?.length
    ? [...new Set(input.acceptanceIntentIds)]
    : [DEFAULT_ACCEPTANCE_INTENT_ID];
  let coalescedUnitsCount = 0;
  const mergedFrom: Record<string, string[]> = {};
  const criticDecisions: GranularityCriticDecision[] = [];

  const compile = (
    task: ArchitectTaskInput,
    depth: number,
    forceComposite = false
  ): WorkUnit => {
    if (depth > MAX_COMPILER_DEPTH) {
      throw new Error(`Adaptive work-unit tree exceeded compiler depth ${MAX_COMPILER_DEPTH} at ${task.nodeId}.`);
    }
    if (seenIds.has(task.nodeId)) throw new Error(`Duplicate adaptive unit key: ${task.nodeId}.`);
    seenIds.add(task.nodeId);

    const architect = runArchitectPass(task);
    const assessment = forceComposite
      ? {
          ...architect.assessment,
          isLeaf: false,
          nodeKind: "CompositeNode" as const,
          recommendedBranchingFactor: architect.assessment.recommendedBranchingFactor ?? 2,
          rationale: `${architect.assessment.rationale} Under-splitting critic forced re-splitting.`
        }
      : architect.assessment;
    assessments[task.nodeId] = assessment;
    const common = {
      key: task.nodeId,
      title: task.title,
      objective: task.goal,
      concerns: [task.goal],
      expectedOutcomes: [`Complete ${task.title} within its declared scope.`],
      acceptanceIntentIds,
      evidenceIds: [],
      plannedPaths: [...architect.targetScopePaths]
    };

    if (assessment.isLeaf) {
      const leaf: WorkUnit = { ...common, kind: "leaf" };
      units.push(leaf);
      return leaf;
    }

    const architectProposed = (task.proposedUnits?.length ?? 0) > 0;
    const proposals = architectProposed
      ? task.proposedUnits ?? []
      : synthesizeUnits(task, assessment.recommendedBranchingFactor ?? 2);
    const review = architectProposed
      ? reviewGranularityProposal(proposals)
      : {
          units: proposals.flatMap((proposal) => reviewGranularityProposal([proposal]).units),
          decisions: [],
          coalescedUnitsCount: 0
        };
    coalescedUnitsCount += review.coalescedUnitsCount;
    criticDecisions.push(...review.decisions);
    for (const reviewed of review.units) {
      if (reviewed.mergedFrom.length > 1) mergedFrom[reviewed.nodeId] = [...reviewed.mergedFrom];
    }
    const composite: WorkUnit = {
      ...common,
      kind: "composite",
      cut: {
        criterion: "cohesion",
        rationale: assessment.rationale
      },
      children: review.units.map((unit) =>
        compile(
          {
            nodeId: unit.nodeId,
            title: unit.title,
            goal: unit.goal,
            targetScopePaths: unit.targetScopePaths,
            complexity: unit.complexity,
            ...(unit.expectedDependencies === undefined ? {} : { expectedDependencies: unit.expectedDependencies }),
            ...(unit.proposedUnits === undefined || unit.proposedUnits.length === 0
              ? {}
              : { proposedUnits: unit.proposedUnits })
          },
          depth + 1,
          unit.forceComposite
        )
      )
    };
    units.push(composite);
    return composite;
  };

  const root = compile(input, 0);
  return { root, units, assessments, coalescedUnitsCount, mergedFrom, criticDecisions };
}

export class AdaptiveGranularityCompiler {
  compile(input: ArchitectTaskInput): AdaptiveWorkUnitCompilation {
    return compileAdaptiveWorkUnitTree(input);
  }
}

function synthesizeUnits(task: ArchitectTaskInput, requestedBranches: number): ProposedGranularityUnit[] {
  const branchCount = Math.max(2, Math.min(requestedBranches, Math.max(2, task.targetScopePaths.length)));
  const pathGroups = Array.from({ length: branchCount }, () => [] as string[]);
  task.targetScopePaths.forEach((path, index) => pathGroups[index % branchCount]!.push(path));
  const nonEmptyGroups = pathGroups.filter((paths) => paths.length > 0);
  const groups = nonEmptyGroups.length >= 2
    ? nonEmptyGroups
    : [[...task.targetScopePaths], [...task.targetScopePaths]];

  return groups.map((paths, index) => {
    const divisor = Math.max(2, groups.length);
    return {
      nodeId: `${task.nodeId}:part-${index + 1}`,
      title: `${task.title} — part ${index + 1}`,
      goal: `Implement cohesive part ${index + 1} of: ${task.goal}`,
      targetScopePaths: [...new Set(paths)],
      expectedDependencies: [],
      complexity: {
        scopeRadius: Math.min(3, Math.max(1, paths.length)),
        interfaceImpact: task.complexity.interfaceImpact / divisor,
        validationSurface: task.complexity.validationSurface / divisor,
        contextTokenMass: task.complexity.contextTokenMass / divisor
      }
    };
  });
}
