import type { TaskContractBundle } from "@manyhands/contracts";
import { RepositorySnapshotSchema, type RepositorySnapshot } from "@manyhands/repository-index";
import {
  GraphRevisionSchema,
  type ArtifactRequirement,
  type ConflictConstraint,
  type GraphRevision,
  type SeamBinding,
  type TaskNodeV2
} from "@manyhands/task-graph";
import { assertPlanReview, reviewCompiledPlan, type PlanReview } from "../critics/review.js";
import { WorkBreakdownSchema, type WorkBreakdown, type WorkUnit } from "../planner/schema.js";
import { compileContractBundles } from "./contract-compiler.js";

export interface GraphCompilerInput {
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
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
  graph: GraphRevision;
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
  const breakdown = WorkBreakdownSchema.parse(rawInput.breakdown);
  RepositorySnapshotSchema.parse(rawInput.repositorySnapshot);
  const repositorySnapshot = rawInput.repositorySnapshot;
  if (breakdown.repositorySnapshotId !== repositorySnapshot.snapshotId) {
    throw new Error(`WorkBreakdown references repository snapshot ${breakdown.repositorySnapshotId}, received ${repositorySnapshot.snapshotId}.`);
  }
  if (repositorySnapshot.inspectionDisposition === "unavailable" || repositorySnapshot.index === undefined) {
    throw new Error("Cannot compile an executable graph from an unavailable repository snapshot.");
  }

  const units = flattenUnits(breakdown.root);
  const nodeIdByUnitKey = Object.fromEntries(units.map((unit) => [unit.key, dependencies.idFor("node", unit.key)]));
  const nodes = compileNodes(breakdown.root, nodeIdByUnitKey);
  const contractResult = compileContractBundles({ breakdown, repositorySnapshot, nodeIdByUnitKey }, dependencies);
  const trace: CompilationRelationTrace[] = [];

  const artifactRequirements: ArtifactRequirement[] = [];
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

  const seamBindings: SeamBinding[] = [];
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

  const conflictConstraints = compileScopeConflicts(contractResult.scopePathsByNodeId, dependencies, trace);
  const graph = GraphRevisionSchema.parse({
    schemaVersion: 2,
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
  });
  const review = reviewCompiledPlan({ breakdown, repositorySnapshot, graph, contracts: contractResult.bundles });
  assertPlanReview(review);
  return {
    graph,
    contracts: contractResult.bundles,
    review,
    trace: { unitNodeIds: nodeIdByUnitKey, relations: trace }
  };
}

function compileNodes(root: WorkUnit, nodeIdByUnitKey: Record<string, string>): Record<string, TaskNodeV2> {
  const nodes: Record<string, TaskNodeV2> = {};
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

function compileScopeConflicts(
  scopes: Record<string, string[]>,
  dependencies: GraphCompilerDependencies,
  trace: CompilationRelationTrace[]
): ConflictConstraint[] {
  const entries = Object.entries(scopes).sort(([left], [right]) => left.localeCompare(right));
  const constraints: ConflictConstraint[] = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftNodeId, leftPaths] = entries[leftIndex]!;
      const [rightNodeId, rightPaths] = entries[rightIndex]!;
      const overlap = leftPaths.filter((path) => rightPaths.includes(path));
      if (overlap.length === 0) continue;
      const id = dependencies.idFor("conflict-constraint", `${leftNodeId}-${rightNodeId}`);
      constraints.push({ id, leftNodeId, rightNodeId, reason: `Scopes overlap on ${overlap.join(", ")}.`, risk: "high" });
      trace.push({ sourceType: "scope_overlap", sourceId: `${leftNodeId}:${rightNodeId}`, compiledRelationIds: [id], evidenceIds: overlap });
    }
  }
  return constraints;
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function requireNodeId(nodeIdByUnitKey: Record<string, string>, key: string): string {
  const nodeId = nodeIdByUnitKey[key];
  if (nodeId === undefined) throw new Error(`Missing compiled node id for semantic unit ${key}.`);
  return nodeId;
}
