import { TaskContractBundleSchema, type ArtifactContract, type SeamContract, type TaskContractBundle, type ValidationObligation } from "@manyhands/contracts";
import { GraphRevisionSchema, type GraphRevision, type TaskNodeV2 } from "@manyhands/task-graph";
import { digest } from "./canonicalize.js";
import type {
  CanonicalLeafModule,
  CanonicalModule,
  CanonicalSeam,
  ExecutionCut,
  ExecutionCutAssessment,
  PlanningContext,
  PlanningIssue,
  SemanticCompilation,
  SemanticPlan
} from "./model.js";

const MAX_COMPOSITE_LEAVES = 4;
const MAX_EXECUTION_SCOPE_PATHS = 6;
const MAX_EXECUTION_OUTCOMES = 6;

interface ProjectedSeam extends CanonicalSeam {
  producerModuleId: string;
  consumerModuleIds: string[];
}

export function executionCutIssues(plan: SemanticPlan): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  if (plan.root.kind !== "composite") {
    issues.push({ code: "root_must_be_composite", message: "The semantic root must remain an integration boundary." });
  }
  for (const leaf of flattenModules(plan.root).filter((module): module is CanonicalLeafModule => module.kind === "leaf")) {
    const scopePathCount = modulePaths(leaf).length;
    if (scopePathCount > MAX_EXECUTION_SCOPE_PATHS) {
      issues.push({
        code: "leaf_scope_limit_exceeded",
        message: `Leaf ${leaf.moduleId} declares ${scopePathCount} scope paths; the hard limit is ${MAX_EXECUTION_SCOPE_PATHS}.`
      });
    }
    if (leaf.outcomes.length > MAX_EXECUTION_OUTCOMES) {
      issues.push({
        code: "leaf_outcome_limit_exceeded",
        message: `Leaf ${leaf.moduleId} owns ${leaf.outcomes.length} outcomes; the hard limit is ${MAX_EXECUTION_OUTCOMES}.`
      });
    }
  }
  return issues;
}

export function selectExecutionCut(plan: SemanticPlan): ExecutionCut {
  const executableModuleIds: string[] = [];
  const assessments: ExecutionCutAssessment[] = [];
  const visit = (module: CanonicalModule, isRoot: boolean): void => {
    const metrics = moduleMetrics(module);
    if (module.kind === "leaf") {
      executableModuleIds.push(module.moduleId);
      assessments.push({ moduleId: module.moduleId, decision: "execute_leaf", reasons: ["declared_semantic_leaf"], metrics });
      return;
    }
    const connected = descendantsAreConnected(module, plan);
    const withinLimits = metrics.leafCount <= MAX_COMPOSITE_LEAVES
      && metrics.scopePathCount <= MAX_EXECUTION_SCOPE_PATHS
      && metrics.outcomeCount <= MAX_EXECUTION_OUTCOMES;
    if (!isRoot && connected && withinLimits) {
      executableModuleIds.push(module.moduleId);
      assessments.push({
        moduleId: module.moduleId,
        decision: "execute_composite",
        reasons: ["descendants_are_connected", "within_hard_limits"],
        metrics
      });
      return;
    }
    const reasons = [
      ...(isRoot ? ["root_must_remain_integration_boundary"] : []),
      ...(connected ? [] : ["descendants_are_independent"]),
      ...(withinLimits ? [] : ["hard_limit_exceeded"])
    ];
    assessments.push({ moduleId: module.moduleId, decision: "expand", reasons, metrics });
    for (const child of module.children) visit(child, false);
  };
  visit(plan.root, true);
  return {
    cutId: `execution-cut:${digest({ planId: plan.planId, executableModuleIds, policy: "bounded-cohesion-v1" })}`,
    planId: plan.planId,
    executableModuleIds,
    policy: "bounded-cohesion-v1",
    assessments
  };
}

export function compileSemanticPlan(
  plan: SemanticPlan,
  cut: ExecutionCut,
  context: PlanningContext,
  createdAt: string
): SemanticCompilation {
  if (plan.repositorySnapshotId !== context.repositorySnapshot.snapshotId) {
    throw new Error("SemanticPlan snapshot does not match the frozen planning context.");
  }
  if (cut.planId !== plan.planId) throw new Error("ExecutionCut belongs to a different SemanticPlan.");

  const moduleById = new Map(flattenModules(plan.root).map((module) => [module.moduleId, module]));
  const selected = new Set(cut.executableModuleIds);
  const executableModules = cut.executableModuleIds.map((moduleId) => {
    const module = moduleById.get(moduleId);
    if (module === undefined) throw new Error(`ExecutionCut references unknown module ${moduleId}.`);
    return executableModule(module);
  });
  const ownerByModuleId = executionOwners(plan.root, selected);
  const projectedSeams = projectSeams(plan.seams, ownerByModuleId);
  const artifactContracts = [
    ...compileArtifactContracts(projectedSeams),
    ...compileNodeOutputArtifactContracts(plan.root, selected)
  ];
  const seamContracts = compileSeamContracts(projectedSeams);
  const nodes = compileNodes(plan.root, selected);
  const graph = GraphRevisionSchema.parse({
    schemaVersion: 2,
    graphId: `graph:${digest({ planId: plan.planId, cutId: cut.cutId })}`,
    revision: 1,
    rootId: plan.root.moduleId,
    baseCommit: context.repositorySnapshot.baseCommit,
    repositorySnapshotId: context.repositorySnapshot.snapshotId,
    nodes,
    artifactRequirements: compileArtifactRequirements(projectedSeams, artifactContracts),
    seamBindings: compileSeamBindings(projectedSeams, seamContracts),
    conflictConstraints: compileScopeConflicts(executableModules),
    legacyOrderingConstraints: [],
    createdAt
  });
  const contracts = Object.keys(nodes).sort().map((nodeId) => {
    const module = moduleById.get(nodeId);
    if (module === undefined) throw new Error(`Graph node ${nodeId} has no semantic module.`);
    const contractModule = module.kind === "leaf" ? module : executableModule(module);
    return compileLeafContract(
      contractModule,
      seamContracts.filter((seam) => seam.producerNodeId === nodeId || seam.consumerNodeIds.includes(nodeId)),
      artifactContracts.filter((artifact) => artifact.producerNodeId === nodeId || artifact.consumerNodeIds.includes(nodeId)),
      context.constraints ?? []
    );
  });
  return { graph, contracts, compilationHash: digest({ graph, contracts }) };
}

function compileNodeOutputArtifactContracts(
  root: CanonicalModule,
  selected: ReadonlySet<string>
): ArtifactContract[] {
  const nodes: Array<{ module: CanonicalModule; parentId: string | null }> = [];
  const visit = (module: CanonicalModule, parentId: string | null): void => {
    nodes.push({ module, parentId });
    if (module.kind === "composite" && !selected.has(module.moduleId)) {
      for (const child of module.children) visit(child, module.moduleId);
    }
  };
  visit(root, null);
  return nodes.map(({ module, parentId }) => {
    const producerNodeId = module.moduleId;
    const base = {
      schemaVersion: 2 as const,
      id: `artifact-contract:${digest(`${module.moduleId}-output`)}`,
      provenance: "compiled" as const,
      producerNodeId,
      consumerNodeIds: parentId === null ? [] : [parentId],
      artifactType: parentId === null ? "final-candidate" : "node-result",
      mediaType: "application/vnd.manyhands.git-commit",
      materialization: "commit" as const,
      expectedPaths: unique(descendantLeaves(module).flatMap(modulePaths))
    };
    return { ...base, revision: digest(base) };
  });
}

function compileNodes(root: CanonicalModule, selected: ReadonlySet<string>): Record<string, TaskNodeV2> {
  const nodes: Record<string, TaskNodeV2> = {};
  const visit = (module: CanonicalModule, parentId: string | null): void => {
    const isSelected = selected.has(module.moduleId);
    if (module.kind === "leaf" && !isSelected) throw new Error(`ExecutionCut leaves semantic leaf ${module.moduleId} uncovered.`);
    nodes[module.moduleId] = {
      id: module.moduleId,
      parentId,
      kind: parentId === null ? "root" : isSelected ? "leaf" : module.kind,
      title: module.title,
      goal: module.objective
    };
    if (!isSelected && module.kind === "composite") for (const child of module.children) visit(child, module.moduleId);
  };
  visit(root, null);
  return nodes;
}

function executionOwners(root: CanonicalModule, selected: ReadonlySet<string>): Map<string, string> {
  const owners = new Map<string, string>();
  const assignSubtree = (module: CanonicalModule, ownerId: string): void => {
    owners.set(module.moduleId, ownerId);
    if (module.kind === "composite") for (const child of module.children) assignSubtree(child, ownerId);
  };
  const visit = (module: CanonicalModule): void => {
    if (selected.has(module.moduleId)) {
      assignSubtree(module, module.moduleId);
      return;
    }
    if (module.kind === "leaf") throw new Error(`ExecutionCut leaves semantic leaf ${module.moduleId} uncovered.`);
    for (const child of module.children) visit(child);
  };
  visit(root);
  return owners;
}

function executableModule(module: CanonicalModule): CanonicalLeafModule {
  if (module.kind === "leaf") return module;
  const leaves = descendantLeaves(module);
  return {
    kind: "leaf",
    moduleId: module.moduleId,
    title: module.title,
    objective: module.objective,
    surface: {
      existingPaths: unique(leaves.flatMap((leaf) => leaf.surface.existingPaths)),
      plannedPaths: unique(leaves.flatMap((leaf) => leaf.surface.plannedPaths))
    },
    outcomes: leaves.flatMap((leaf) => leaf.outcomes)
  };
}

function projectSeams(seams: readonly CanonicalSeam[], owners: ReadonlyMap<string, string>): ProjectedSeam[] {
  return seams.flatMap((seam) => {
    const producerModuleId = requireOwner(owners, seam.producerModuleId);
    const consumerModuleIds = unique(seam.consumerModuleIds.map((id) => requireOwner(owners, id)))
      .filter((id) => id !== producerModuleId);
    return consumerModuleIds.length === 0 ? [] : [{ ...seam, producerModuleId, consumerModuleIds }];
  });
}

function compileLeafContract(
  module: CanonicalLeafModule,
  seams: SeamContract[],
  artifacts: ArtifactContract[],
  constraints: string[]
): TaskContractBundle {
  const allowedPaths = unique([...module.surface.existingPaths, ...module.surface.plannedPaths]);
  const criteria = module.outcomes.flatMap((outcome) => outcome.covers.map((criterionId) => ({
    id: criterionId,
    kind: outcome.verification.capability === "typecheck" ? "static" as const : "unit" as const,
    description: outcome.statement,
    required: true
  })));
  const uniqueCriteria = [...new Map(criteria.map((criterion) => [criterion.id, criterion])).values()];
  const obligations: ValidationObligation[] = uniqueCriteria.map((criterion, index) => {
    const owner = module.outcomes.find((outcome) => outcome.covers.includes(criterion.id));
    if (owner === undefined) throw new Error(`Criterion ${criterion.id} lost its semantic owner.`);
    const isStatic = owner.verification.capability === "typecheck";
    return {
      id: `validation-obligation:${digest({ moduleId: module.moduleId, criterionId: criterion.id, index })}`,
      criterionId: criterion.id,
      layer: isStatic ? "static" : "unit",
      severity: "required",
      acceptableEvidence: [isStatic ? "static_analysis" : "test_result"],
      baselinePolicy: "optional",
      negativeControl: "when_feasible",
      flakyPolicy: "forbid",
      evidence: isStatic
        ? { kind: "static_proof", references: owner.verification.references }
        : { kind: "focused_command", selectors: owner.verification.references, references: owner.verification.references }
    };
  });
  const scopeRevision = digest({ moduleId: module.moduleId, allowedPaths });
  const validationRevision = digest({ moduleId: module.moduleId, obligations });
  const consumes = artifacts
    .filter((artifact) => artifact.consumerNodeIds.includes(module.moduleId))
    .map(({ id, revision }) => ({ id, revision }));
  const produces = artifacts
    .filter((artifact) => artifact.producerNodeId === module.moduleId)
    .map(({ id, revision }) => ({ id, revision }));
  const taskRevision = digest({ moduleId: module.moduleId, criteria: uniqueCriteria, scopeRevision, validationRevision, consumes, produces, seams, constraints });
  return TaskContractBundleSchema.parse({
    schemaVersion: 2,
    task: {
      schemaVersion: 2,
      id: `task-contract:${digest(module.moduleId)}`,
      revision: taskRevision,
      provenance: "compiled",
      nodeId: module.moduleId,
      goal: module.objective,
      acceptanceCriteria: uniqueCriteria,
      scope: { id: `scope-contract:${digest(module.moduleId)}`, revision: scopeRevision },
      consumes,
      produces,
      seams: seams.map(({ id, revision }) => ({ id, revision })),
      validation: { id: `validation-contract:${digest(module.moduleId)}`, revision: validationRevision },
      constraints
    },
    scope: {
      schemaVersion: 2,
      id: `scope-contract:${digest(module.moduleId)}`,
      revision: scopeRevision,
      provenance: "compiled",
      nodeId: module.moduleId,
      allowedPaths,
      forbiddenPaths: [],
      coordinationPaths: [],
      outputRoots: []
    },
    seams,
    artifacts,
    validation: {
      schemaVersion: 2,
      id: `validation-contract:${digest(module.moduleId)}`,
      revision: validationRevision,
      provenance: "compiled",
      nodeId: module.moduleId,
      obligations
    }
  });
}

function compileSeamContracts(seams: readonly ProjectedSeam[]): SeamContract[] {
  return seams.map((seam) => {
    const revision = digest({
      producerModuleId: seam.producerModuleId,
      consumerModuleIds: seam.consumerModuleIds,
      interface: seam.interface,
      evidencePaths: seam.evidencePaths
    });
    return {
      schemaVersion: 2,
      id: `seam-contract:${digest(seam.seamId)}`,
      revision,
      provenance: "compiled",
      kind: seam.interface.kind,
      specification: seam.interface.specification,
      producerNodeId: seam.producerModuleId,
      consumerNodeIds: seam.consumerModuleIds,
      semanticFacts: {
        materialization: seam.interface.materialization,
        verification: seam.interface.verification,
        evidence: seam.evidencePaths.join(",") || "semantic-plan"
      },
      compatibility: { mode: seam.interface.compatibility, rules: [] },
      ...(seam.interface.materialization === "logical"
        ? {}
        : { baselineArtifactContractId: artifactContractId(seam) })
    };
  });
}

function compileArtifactContracts(seams: readonly ProjectedSeam[]): ArtifactContract[] {
  return seams
    .filter((seam) => seam.interface.materialization !== "logical")
    .map((seam) => ({
      schemaVersion: 2,
      id: artifactContractId(seam),
      revision: digest({
        seamId: seam.seamId,
        producerNodeId: seam.producerModuleId,
        consumerNodeIds: seam.consumerModuleIds,
        materialization: seam.interface.materialization,
        artifactPaths: seam.interface.artifactPaths
      }),
      provenance: "compiled",
      producerNodeId: seam.producerModuleId,
      consumerNodeIds: seam.consumerModuleIds,
      artifactType: "semantic-seam-output",
      materialization: seam.interface.materialization,
      expectedPaths: seam.interface.artifactPaths
    }));
}

function compileArtifactRequirements(
  seams: readonly ProjectedSeam[],
  artifacts: readonly ArtifactContract[]
): GraphRevision["artifactRequirements"] {
  return seams.flatMap((seam) => {
    if (seam.interface.materialization === "logical") return [];
    const artifact = artifacts.find((candidate) => candidate.id === artifactContractId(seam));
    if (artifact === undefined) throw new Error(`Missing artifact contract for materialized seam ${seam.seamId}.`);
    return seam.consumerModuleIds.map((consumerNodeId) => ({
      id: `artifact-requirement:${digest({ seamId: seam.seamId, consumerNodeId })}`,
      artifactContract: { id: artifact.id, revision: artifact.revision },
      producerNodeId: seam.producerModuleId,
      consumerNodeId,
      requiredFor: "execution" as const
    }));
  });
}

function compileSeamBindings(
  seams: readonly ProjectedSeam[],
  contracts: readonly SeamContract[]
): GraphRevision["seamBindings"] {
  return seams.flatMap((seam, seamIndex) => {
    const contract = contracts[seamIndex];
    if (contract === undefined) throw new Error(`Missing compiled seam contract for ${seam.seamId}.`);
    return seam.consumerModuleIds.map((consumerModuleId) => ({
      id: `seam-binding:${digest({ seamId: seam.seamId, consumerModuleId })}`,
      seamContract: { id: contract.id, revision: contract.revision },
      producerNodeId: seam.producerModuleId,
      consumerNodeId: consumerModuleId,
      producerRevision: contract.revision,
      consumerRevision: contract.revision
    }));
  });
}

function compileScopeConflicts(leaves: readonly CanonicalLeafModule[]): GraphRevision["conflictConstraints"] {
  const conflicts: GraphRevision["conflictConstraints"] = [];
  for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < leaves.length; rightIndex += 1) {
      const left = leaves[leftIndex]!;
      const right = leaves[rightIndex]!;
      const overlap = modulePaths(left).filter((path) => modulePaths(right).includes(path));
      if (overlap.length === 0) continue;
      conflicts.push({
        id: `conflict:${digest({ left: left.moduleId, right: right.moduleId, overlap })}`,
        leftNodeId: left.moduleId,
        rightNodeId: right.moduleId,
        reason: `Scopes overlap on ${overlap.join(", ")}.`,
        risk: "high",
        mode: "serialize"
      });
    }
  }
  return conflicts;
}

function descendantsAreConnected(module: Extract<CanonicalModule, { kind: "composite" }>, plan: SemanticPlan): boolean {
  const leaves = descendantLeaves(module);
  if (leaves.length < 2) return false;
  const ids = new Set(leaves.map((leaf) => leaf.moduleId));
  const adjacency = new Map(leaves.map((leaf) => [leaf.moduleId, new Set<string>()]));
  const connect = (left: string, right: string): void => {
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  };
  for (const seam of plan.seams) {
    if (!ids.has(seam.producerModuleId)) continue;
    for (const consumer of seam.consumerModuleIds) if (ids.has(consumer)) connect(seam.producerModuleId, consumer);
  }
  for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < leaves.length; rightIndex += 1) {
      const left = leaves[leftIndex]!;
      const right = leaves[rightIndex]!;
      if (modulePaths(left).some((path) => modulePaths(right).includes(path))) connect(left.moduleId, right.moduleId);
    }
  }
  const visited = new Set<string>();
  const pending = [leaves[0]!.moduleId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return visited.size === leaves.length;
}

function moduleMetrics(module: CanonicalModule): ExecutionCutAssessment["metrics"] {
  const leaves = descendantLeaves(module);
  return {
    leafCount: leaves.length,
    scopePathCount: unique(leaves.flatMap(modulePaths)).length,
    outcomeCount: leaves.reduce((total, leaf) => total + leaf.outcomes.length, 0)
  };
}

function descendantLeaves(module: CanonicalModule): CanonicalLeafModule[] {
  return module.kind === "leaf" ? [module] : module.children.flatMap(descendantLeaves);
}

function modulePaths(module: CanonicalLeafModule): string[] {
  return unique([...module.surface.existingPaths, ...module.surface.plannedPaths]);
}

function flattenModules(root: CanonicalModule): CanonicalModule[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenModules)];
}

function requireOwner(owners: ReadonlyMap<string, string>, moduleId: string): string {
  const owner = owners.get(moduleId);
  if (owner === undefined) throw new Error(`ExecutionCut has no owner for semantic module ${moduleId}.`);
  return owner;
}

function artifactContractId(seam: Pick<CanonicalSeam, "seamId">): string {
  return `artifact-contract:${digest(seam.seamId)}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
