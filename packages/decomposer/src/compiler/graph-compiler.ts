import type { SourceContract, TaskContractBundle } from "@manyhands/contracts";
import { RepositorySnapshotSchema, type RepositorySnapshot } from "@manyhands/repository-index";
import {
  LegacyGraphRevisionV2Schema,
  computeLegacyGraphRevisionV2TopologicalLevels,
  type LegacyArtifactRequirementV2,
  type ConflictConstraint,
  type LegacyGraphRevisionV2,
  type LegacySeamBindingV2,
  type LegacyTaskNodeV2
} from "@manyhands/task-graph";
import { assertPlanReview, reviewCompiledPlan, type PlanReview } from "../critics/review.js";
import { WorkBreakdownSchema, type WorkBreakdown, type WorkUnit } from "../planner/schema.js";
import type { CandidatePlan } from "../planner/candidate-plan.js";
import { compileContractBundles } from "./contract-compiler.js";
import { repositorySnapshotIdsMatch } from "../planner/repository-snapshot-id.js";
import { projectSemanticPlanForLegacyCompiler } from "../planner/semantic-plan-projection.js";
import { SemanticPlanSchema, type SemanticPlan } from "../planner/semantic-plan.js";

export interface GraphCompilerInput {
  /** Historical compiler input. New productive planning supplies semanticPlan. */
  breakdown?: WorkBreakdown;
  /** The sole canonical planning representation for the productive route. */
  semanticPlan?: SemanticPlan;
  repositorySnapshot: RepositorySnapshot;
  sourceContract?: SourceContract;
  candidatePlan?: CandidatePlan;
}

export interface GraphCompilerDependencies {
  idFor(kind: string, key: string): string;
  now(): string;
}

export interface CompilationRelationTrace {
  sourceType: "candidate_artifact" | "candidate_seam" | "scope_overlap";
  sourceId: string;
  compiledRelationIds: string[];
  evidenceIds: string[];
}

export interface CompiledGraphRevision {
  graph: LegacyGraphRevisionV2;
  contracts: TaskContractBundle[];
  review: PlanReview;
  trace: {
    unitNodeIds: Record<string, string>;
    relations: CompilationRelationTrace[];
  };
}

export function compileGraphRevision(
  rawInput: GraphCompilerInput,
  dependencies: GraphCompilerDependencies
): CompiledGraphRevision {
  const hasSemanticPlan = rawInput.semanticPlan !== undefined;
  if (hasSemanticPlan && rawInput.breakdown !== undefined) throw new Error("Graph compilation accepts either semanticPlan or legacy breakdown, not both.");
  if (!hasSemanticPlan && rawInput.breakdown === undefined) throw new Error("Graph compilation requires a semanticPlan or legacy breakdown.");
  const semanticPlan = hasSemanticPlan ? SemanticPlanSchema.parse(rawInput.semanticPlan) : undefined;
  if (semanticPlan?.schemaVersion !== undefined && semanticPlan.schemaVersion !== 2) {
    throw new Error("SemanticPlan v1 is legacy_unproven and cannot enter the productive graph compiler; replay it through an explicit legacy audit path.");
  }
  const semanticProjection = semanticPlan === undefined ? undefined : projectSemanticPlanForLegacyCompiler(semanticPlan);
  const breakdown = WorkBreakdownSchema.parse(semanticProjection?.breakdown ?? rawInput.breakdown!);
  const candidatePlan = semanticProjection?.candidatePlan ?? rawInput.candidatePlan;
  RepositorySnapshotSchema.parse(rawInput.repositorySnapshot);
  const repositorySnapshot = rawInput.repositorySnapshot;
  if (!repositorySnapshotIdsMatch(breakdown.repositorySnapshotId, repositorySnapshot.snapshotId)) {
    throw new Error(`WorkBreakdown references repository snapshot ${breakdown.repositorySnapshotId}, received ${repositorySnapshot.snapshotId}.`);
  }
  if (repositorySnapshot.inspectionDisposition === "unavailable" || repositorySnapshot.index === undefined) {
    throw new Error("Cannot compile an executable graph from an unavailable repository snapshot.");
  }

  const units = flattenUnits(breakdown.root);
  const nodeIdByUnitKey = Object.fromEntries(units.map((unit) => [unit.key, dependencies.idFor("node", unit.key)]));
  const nodes = compileNodes(breakdown.root, nodeIdByUnitKey);
  const contractResult = compileContractBundles({
    breakdown,
    repositorySnapshot,
    nodeIdByUnitKey,
    ...(candidatePlan === undefined ? {} : { candidatePlan }),
    ...(rawInput.sourceContract === undefined ? {} : { sourceContract: rawInput.sourceContract })
  }, dependencies);
  const trace: CompilationRelationTrace[] = [];

  const artifactRequirements: LegacyArtifactRequirementV2[] = [];
  for (const candidate of breakdown.candidateArtifacts) {
    const contract = contractResult.artifactContracts.find((item) => item.id === dependencies.idFor("artifact-contract", candidate.id));
    if (contract === undefined) throw new Error(`Artifact contract for ${candidate.id} was not compiled.`);
    const relationIds: string[] = [];
    if (candidate.materializationHint !== "logical") {
      for (const consumerKey of candidate.consumerUnitKeys) {
        const consumerNodeId = requireNodeId(nodeIdByUnitKey, consumerKey);
        const id = dependencies.idFor("artifact-requirement", `${candidate.id}-${consumerKey}`);
        artifactRequirements.push({
          id,
          artifactContract: { id: contract.id, revision: contract.revision },
          producerNodeId: contract.producerNodeId,
          consumerNodeId,
          requiredFor: "execution"
        });
        relationIds.push(id);
      }
    }
    trace.push({ sourceType: "candidate_artifact", sourceId: candidate.id, compiledRelationIds: relationIds, evidenceIds: [...candidate.evidenceIds] });
  }
  propagateMaterializedArtifactRequirements(artifactRequirements, dependencies);
  for (const contract of contractResult.nodeOutputArtifactContracts) {
    for (const consumerNodeId of contract.consumerNodeIds) {
      artifactRequirements.push({
        id: dependencies.idFor("artifact-requirement", `${contract.id}-${consumerNodeId}`),
        artifactContract: { id: contract.id, revision: contract.revision },
        producerNodeId: contract.producerNodeId,
        consumerNodeId,
        requiredFor: "integration"
      });
    }
  }

  const seamBindings: LegacySeamBindingV2[] = [];
  for (const candidate of breakdown.candidateSeams) {
    const contract = contractResult.seamContracts.find((item) => item.id === dependencies.idFor("seam-contract", candidate.id));
    if (contract === undefined) throw new Error(`Seam contract for ${candidate.id} was not compiled.`);
    const relationIds: string[] = [];
    for (const consumerKey of candidate.consumerUnitKeys) {
      const id = dependencies.idFor("seam-binding", `${candidate.id}-${consumerKey}`);
      seamBindings.push({
        id,
        seamContract: { id: contract.id, revision: contract.revision },
        producerNodeId: contract.producerNodeId,
        consumerNodeId: requireNodeId(nodeIdByUnitKey, consumerKey),
        producerRevision: contract.revision,
        consumerRevision: contract.revision
      });
      relationIds.push(id);
    }
    trace.push({ sourceType: "candidate_seam", sourceId: candidate.id, compiledRelationIds: relationIds, evidenceIds: [...candidate.evidenceIds] });
  }

  const conflictConstraints = compileWriteConflicts(contractResult.writePathsByNodeId, nodes, dependencies, trace);
  const draft = {
    schemaVersion: 2 as const,
    graphId: dependencies.idFor("graph", breakdown.breakdownId),
    revision: 1,
    rootId: requireNodeId(nodeIdByUnitKey, breakdown.root.key),
    baseCommit: repositorySnapshot.baseCommit,
    repositorySnapshotId: repositorySnapshot.snapshotId,
    nodes,
    artifactRequirements,
    seamBindings,
    conflictConstraints,
    legacyOrderingConstraints: [],
    createdAt: dependencies.now()
  };
  const graph = LegacyGraphRevisionV2Schema.parse({ ...draft, nodes: withTopologicalLevels(draft) });
  const review = reviewCompiledPlan({ breakdown, repositorySnapshot, graph, contracts: contractResult.bundles, writePathsByNodeId: contractResult.writePathsByNodeId });
  assertPlanReview(review);
  return {
    graph,
    contracts: contractResult.bundles,
    review,
    trace: { unitNodeIds: nodeIdByUnitKey, relations: trace }
  };
}

function propagateMaterializedArtifactRequirements(
  requirements: LegacyArtifactRequirementV2[],
  dependencies: GraphCompilerDependencies
): void {
  const directExecutionRequirements = (): LegacyArtifactRequirementV2[] => requirements.filter((requirement) => requirement.requiredFor === "execution");
  const known = new Set(requirements
    .filter((requirement) => requirement.requiredFor === "execution")
    .map((requirement) => `${requirement.artifactContract.id}|${requirement.consumerNodeId}`));

  let changed = true;
  while (changed) {
    changed = false;
    const executionRequirements = directExecutionRequirements();
    for (const downstream of executionRequirements) {
      for (const upstream of executionRequirements.filter((requirement) => requirement.consumerNodeId === downstream.producerNodeId)) {
        if (upstream.producerNodeId === downstream.consumerNodeId) continue;
        const key = `${upstream.artifactContract.id}|${downstream.consumerNodeId}`;
        if (known.has(key)) continue;
        requirements.push({
          id: dependencies.idFor("artifact-requirement", `${upstream.artifactContract.id}-${downstream.consumerNodeId}-transitive`),
          artifactContract: upstream.artifactContract,
          producerNodeId: upstream.producerNodeId,
          consumerNodeId: downstream.consumerNodeId,
          requiredFor: "execution"
        });
        known.add(key);
        changed = true;
      }
    }
  }
}

function compileNodes(root: WorkUnit, nodeIdByUnitKey: Record<string, string>): Record<string, LegacyTaskNodeV2> {
  const nodes: Record<string, LegacyTaskNodeV2> = {};
  const visit = (unit: WorkUnit, parentId: string | null): void => {
    const id = requireNodeId(nodeIdByUnitKey, unit.key);
    nodes[id] = {
      id,
      parentId,
      kind: parentId === null && unit.kind === "composite" ? "root" : unit.kind,
      title: unit.title,
      goal: unit.objective
    };
    if (unit.kind === "composite") for (const child of unit.children) visit(child, id);
  };
  visit(root, null);
  return nodes;
}

/**
 * Only writers conflict.
 *
 * This used to cross the whole scope, so two units that merely READ one file
 * were declared in conflict and the wave selector refused to run them together
 * — provably safe work, serialized (D9). Under tree-wide P2 the write sets of
 * distinct branches are disjoint, so for a plan this planner produced the
 * result is always empty. It is still computed rather than assumed: the
 * compiler does not get to trust its input.
 */
/**
 * Bands every node by its longest path from the start of the run, for the flow
 * layout to draw. Presentational: nothing in the runtime reads it.
 *
 * A cycle leaves the levels off rather than failing the compile. The plan
 * critics own that diagnosis and produce a far better one (`artifact_cycle`),
 * and they run after this — so throwing here would replace their finding with a
 * worse message about a field that decides nothing.
 */
function withTopologicalLevels(draft: {
  graphId: string;
  nodes: Record<string, LegacyTaskNodeV2>;
  artifactRequirements: LegacyArtifactRequirementV2[];
}): Record<string, LegacyTaskNodeV2> {
  let levels: Record<string, number>;
  try {
    levels = computeLegacyGraphRevisionV2TopologicalLevels(draft as unknown as LegacyGraphRevisionV2);
  } catch {
    return draft.nodes;
  }
  return Object.fromEntries(Object.entries(draft.nodes).map(([id, node]) => [id, {
    ...node,
    ...(levels[id] === undefined ? {} : { topologicalLevel: levels[id]! })
  }]));
}

function compileWriteConflicts(
  scopes: Record<string, string[]>,
  nodes: Record<string, LegacyTaskNodeV2>,
  dependencies: GraphCompilerDependencies,
  trace: CompilationRelationTrace[]
): ConflictConstraint[] {
  const entries = Object.entries(scopes).sort(([left], [right]) => left.localeCompare(right));
  const constraints: ConflictConstraint[] = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftNodeId, leftPaths] = entries[leftIndex]!;
      const [rightNodeId, rightPaths] = entries[rightIndex]!;
      if (isAncestor(nodes, leftNodeId, rightNodeId) || isAncestor(nodes, rightNodeId, leftNodeId)) continue;
      const overlap = leftPaths.filter((path) => rightPaths.includes(path));
      if (overlap.length === 0) continue;
      const id = dependencies.idFor("conflict-constraint", `${leftNodeId}-${rightNodeId}`);
      constraints.push({ id, leftNodeId, rightNodeId, reason: `Both write ${overlap.join(", ")}.`, risk: "high" });
      trace.push({ sourceType: "scope_overlap", sourceId: `${leftNodeId}:${rightNodeId}`, compiledRelationIds: [id], evidenceIds: overlap });
    }
  }
  return constraints;
}

function isAncestor(nodes: Record<string, LegacyTaskNodeV2>, ancestorId: string, descendantId: string): boolean {
  let current = nodes[descendantId]?.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = nodes[current]?.parentId ?? null;
  }
  return false;
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function requireNodeId(nodeIdByUnitKey: Record<string, string>, key: string): string {
  const nodeId = nodeIdByUnitKey[key];
  if (nodeId === undefined) throw new Error(`Missing compiled node id for semantic unit ${key}.`);
  return nodeId;
}
