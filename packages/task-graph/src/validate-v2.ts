import {
  GraphRevisionSchema,
  type GraphRevision,
  type GraphRevisionOperation,
  type ReviseGraphInput
} from "./graph-revision.js";

export type GraphRevisionIssueCode = "schema_invalid" | "missing_root" | "invalid_root" | "invalid_node_kind" | "node_key_mismatch" | "missing_parent" | "hierarchy_cycle" | "missing_relation_node" | "duplicate_relation";

export interface GraphRevisionIssue {
  code: GraphRevisionIssueCode;
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  relationId?: string;
}

export interface ExecutableReadinessV2 {
  nodeId: string;
  ready: boolean;
  missingArtifactContractIds: string[];
}

export function validateGraphRevision(input: GraphRevision): GraphRevisionIssue[] {
  const parsed = GraphRevisionSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => ({ code: "schema_invalid", severity: "error", message: `${issue.path.join(".")}: ${issue.message}` }));
  const graph = parsed.data;
  const issues: GraphRevisionIssue[] = [];
  const root = graph.nodes[graph.rootId];
  if (root === undefined) issues.push({ code: "missing_root", severity: "error", nodeId: graph.rootId, message: `Root ${graph.rootId} does not exist.` });
  else {
    const atomicRoot = root.kind === "leaf" && Object.keys(graph.nodes).length === 1;
    if (root.parentId !== null || (!atomicRoot && root.kind !== "root" && root.kind !== "composite")) {
      issues.push({ code: "invalid_root", severity: "error", nodeId: root.id, message: "The graph root must be a root/composite node, or the only atomic leaf, without a parent." });
    }
  }

  for (const [key, node] of Object.entries(graph.nodes)) {
    if (key !== node.id) issues.push({ code: "node_key_mismatch", severity: "error", nodeId: node.id, message: `Node key ${key} does not match id ${node.id}.` });
    if (node.id !== graph.rootId && (node.parentId === null || graph.nodes[node.parentId] === undefined)) issues.push({ code: "missing_parent", severity: "error", nodeId: node.id, message: `Node ${node.id} has no valid parent.` });
    if (node.id !== graph.rootId && node.kind === "root") issues.push({ code: "invalid_node_kind", severity: "error", nodeId: node.id, message: `Non-root node ${node.id} cannot have kind root.` });
    const hasChildren = Object.values(graph.nodes).some((candidate) => candidate.parentId === node.id);
    if ((node.kind === "leaf" || node.kind === "integrator") && hasChildren) issues.push({ code: "invalid_node_kind", severity: "error", nodeId: node.id, message: `${node.kind} node ${node.id} cannot own child nodes.` });
    if ((node.kind === "root" || node.kind === "composite") && !hasChildren) issues.push({ code: "invalid_node_kind", severity: "error", nodeId: node.id, message: `${node.kind} node ${node.id} must own at least one child.` });
  }
  for (const nodeId of hierarchyCycleNodes(graph)) issues.push({ code: "hierarchy_cycle", severity: "error", nodeId, message: `Hierarchy cycle includes ${nodeId}.` });
  validateRelationNodes(graph, issues);
  validateUniqueIds(graph, issues);
  return issues;
}

export function reviseGraph(graph: GraphRevision, input: ReviseGraphInput): GraphRevision {
  if (graph.revision !== input.expectedRevision) throw new Error(`Graph revision mismatch: expected ${input.expectedRevision}, found ${graph.revision}.`);
  if (input.operations.length === 0) throw new Error("A semantic graph revision requires at least one operation.");
  const next = structuredClone(graph);
  for (const operation of input.operations) applyOperation(next, operation);
  next.revision += 1;
  next.createdAt = input.createdAt ?? new Date().toISOString();
  const errors = validateGraphRevision(next).filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new Error(`Graph revision is invalid: ${errors.map((issue) => issue.message).join("; ")}`);
  return next;
}

export function getExecutableReadinessV2(graph: GraphRevision, options: { availableArtifactContractIds: readonly string[] }): ExecutableReadinessV2[] {
  const available = new Set(options.availableArtifactContractIds);
  return Object.values(graph.nodes)
    .filter((node) => node.kind === "leaf" || node.kind === "integrator")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => {
      const missingArtifactContractIds = graph.artifactRequirements
        .filter((item) => item.consumerNodeId === node.id && item.requiredFor === "execution")
        .map((item) => item.artifactContract.id)
        .filter((id) => !available.has(id))
        .filter((id, index, all) => all.indexOf(id) === index)
        .sort();
      return { nodeId: node.id, ready: missingArtifactContractIds.length === 0, missingArtifactContractIds };
    });
}

function hierarchyCycleNodes(graph: GraphRevision): string[] {
  const result = new Set<string>();
  for (const start of Object.keys(graph.nodes)) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | null | undefined = start;
    while (current !== null && current !== undefined && graph.nodes[current] !== undefined) {
      const position = positions.get(current);
      if (position !== undefined) {
        for (const id of path.slice(position)) result.add(id);
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = graph.nodes[current]?.parentId;
    }
  }
  return [...result].sort();
}

function validateRelationNodes(graph: GraphRevision, issues: GraphRevisionIssue[]): void {
  const relations = [
    ...graph.artifactRequirements.map((item) => ({ id: item.id, nodes: [item.producerNodeId, item.consumerNodeId] })),
    ...graph.seamBindings.map((item) => ({ id: item.id, nodes: [item.producerNodeId, item.consumerNodeId] })),
    ...graph.conflictConstraints.map((item) => ({ id: item.id, nodes: [item.leftNodeId, item.rightNodeId] })),
    ...graph.legacyOrderingConstraints.map((item) => ({ id: item.id, nodes: [item.fromNodeId, item.toNodeId] }))
  ];
  for (const relation of relations) for (const nodeId of relation.nodes) if (graph.nodes[nodeId] === undefined) issues.push({ code: "missing_relation_node", severity: "error", relationId: relation.id, nodeId, message: `Relation ${relation.id} references missing node ${nodeId}.` });
}

function validateUniqueIds(graph: GraphRevision, issues: GraphRevisionIssue[]): void {
  const ids = [...graph.artifactRequirements, ...graph.seamBindings, ...graph.conflictConstraints, ...graph.legacyOrderingConstraints].map((item) => item.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issues.push({ code: "duplicate_relation", severity: "error", relationId: id, message: `Relation id ${id} is duplicated.` });
    seen.add(id);
  }
}

function applyOperation(graph: GraphRevision, operation: GraphRevisionOperation): void {
  switch (operation.type) {
    case "upsert_node": graph.nodes[operation.node.id] = structuredClone(operation.node); return;
    case "remove_node": delete graph.nodes[operation.nodeId]; return;
    case "update_node_goal": {
      const node = graph.nodes[operation.nodeId];
      if (node === undefined) throw new Error(`Unknown graph node ${operation.nodeId}.`);
      node.goal = operation.goal;
      return;
    }
    case "add_artifact_requirement": graph.artifactRequirements.push(structuredClone(operation.requirement)); return;
    case "remove_artifact_requirement": graph.artifactRequirements = graph.artifactRequirements.filter((item) => item.id !== operation.requirementId); return;
    case "add_seam_binding": graph.seamBindings.push(structuredClone(operation.binding)); return;
    case "remove_seam_binding": graph.seamBindings = graph.seamBindings.filter((item) => item.id !== operation.bindingId); return;
    case "add_conflict_constraint": graph.conflictConstraints.push(structuredClone(operation.constraint)); return;
    case "remove_conflict_constraint": graph.conflictConstraints = graph.conflictConstraints.filter((item) => item.id !== operation.constraintId); return;
    case "remove_legacy_ordering_constraint": graph.legacyOrderingConstraints = graph.legacyOrderingConstraints.filter((item) => item.id !== operation.constraintId); return;
  }
}
