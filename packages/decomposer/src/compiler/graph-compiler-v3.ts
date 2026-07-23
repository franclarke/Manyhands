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

    const proposals = task.proposedUnits ?? [];
    if (proposals.length === 0) {
      // The policy judged this unit composite, but only the Architect can say
      // HOW it decomposes. Partitioning the declared paths mechanically
      // produces units that do not match the real shape of the work: a
      // canonical run showed every such fabricated part violating its own
      // scope, because implementing an API slice also needs the domain type it
      // depends on. Detecting excess complexity is the policy's job; inventing
      // the semantic cut is not. Keep the cohesive leaf and record the tension.
      criticDecisions.push({
        kind: "resplit_declined",
        unitIds: [task.nodeId],
        rationale: `C_task=${assessment.complexityScore.toFixed(2)} exceeds the leaf threshold, but the Architect proposed no sub-units for ${task.nodeId}; a mechanical split would fabricate incoherent scopes.`
      });
      assessments[task.nodeId] = {
        ...assessment,
        isLeaf: true,
        nodeKind: "LeafNode",
        rationale: `${assessment.rationale} Kept as a leaf: the Architect proposed no semantic sub-units.`
      };
      const leaf: WorkUnit = { ...common, kind: "leaf" };
      units.push(leaf);
      return leaf;
    }
    const review = reviewGranularityProposal(proposals);
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

