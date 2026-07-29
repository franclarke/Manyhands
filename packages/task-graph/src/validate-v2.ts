import {
  GraphRevisionSchema,
  type GraphRevision,
  type GraphRevisionOperation,
  type ReviseGraphInput
} from "./graph-revision.js";

export type GraphRevisionIssueCode = "schema_invalid" | "missing_root" | "invalid_root" | "invalid_node_kind" | "node_key_mismatch" | "missing_parent" | "hierarchy_cycle" | "artifact_cycle" | "self_relation" | "missing_relation_node" | "duplicate_relation";

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
  checkCyclesAndSelfRelations(graph, issues);
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

type EdgeType = "hierarchy" | "artifact" | "legacy";
interface Edge {
  to: string;
  type: EdgeType;
}

function checkCyclesAndSelfRelations(graph: GraphRevision, issues: GraphRevisionIssue[]): void {
  const adjacency = new Map<string, Edge[]>();
  for (const nodeId of Object.keys(graph.nodes)) adjacency.set(nodeId, []);

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.parentId !== null) {
      if (node.parentId === nodeId) {
        issues.push({ code: "self_relation", severity: "error", nodeId, message: `Node ${nodeId} cannot be its own parent.` });
      } else {
        let edges = adjacency.get(node.parentId);
        if (!edges) { edges = []; adjacency.set(node.parentId, edges); }
        edges.push({ to: nodeId, type: "hierarchy" });
      }
    }
  }

  for (const req of graph.artifactRequirements) {
    if (req.producerNodeId === req.consumerNodeId) {
      issues.push({ code: "self_relation", severity: "error", relationId: req.id, message: `Self relation in artifact requirement ${req.id}.` });
    } else if (req.requiredFor === "execution") {
      let edges = adjacency.get(req.producerNodeId);
      if (!edges) { edges = []; adjacency.set(req.producerNodeId, edges); }
      edges.push({ to: req.consumerNodeId, type: "artifact" });
    }
  }

  // A seam freezes contract compatibility between participants. It does not
  // materialize an output or impose readiness, so it must not become an edge in
  // the execution DAG. Bidirectional API/callback seams are valid even when an
  // artifact requirement between the same nodes points only one way.
  for (const binding of graph.seamBindings) {
    if (binding.producerNodeId === binding.consumerNodeId) {
      issues.push({ code: "self_relation", severity: "error", relationId: binding.id, message: `Self relation in seam binding ${binding.id}.` });
    }
  }

  for (const constraint of graph.conflictConstraints) {
    if (constraint.leftNodeId === constraint.rightNodeId) {
      issues.push({ code: "self_relation", severity: "error", relationId: constraint.id, message: `Self relation in conflict constraint ${constraint.id}.` });
    }
  }

  for (const legacy of graph.legacyOrderingConstraints) {
    if (legacy.fromNodeId === legacy.toNodeId) {
      issues.push({ code: "self_relation", severity: "error", relationId: legacy.id, message: `Self relation in legacy ordering constraint ${legacy.id}.` });
    } else {
      let edges = adjacency.get(legacy.fromNodeId);
      if (!edges) { edges = []; adjacency.set(legacy.fromNodeId, edges); }
      edges.push({ to: legacy.toNodeId, type: "legacy" });
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleIssues = new Map<string, GraphRevisionIssueCode>();

  function dfs(nodeId: string, path: string[], edgesInPath: EdgeType[]) {
    if (visiting.has(nodeId)) {
      const startIdx = path.indexOf(nodeId);
      if (startIdx !== -1) {
        const cyclePathNodes = path.slice(startIdx);
        const cycleEdges = edgesInPath.slice(startIdx);
        const isHierarchyOnly = cycleEdges.every((e) => e === "hierarchy");
        const code: GraphRevisionIssueCode = isHierarchyOnly ? "hierarchy_cycle" : "artifact_cycle";
        for (const n of cyclePathNodes) {
          const existing = cycleIssues.get(n);
          if (existing !== "artifact_cycle") cycleIssues.set(n, code);
        }
      }
      return;
    }
    if (visited.has(nodeId)) return;

    visiting.add(nodeId);
    path.push(nodeId);

    const edges = adjacency.get(nodeId) || [];
    for (const edge of edges) {
      edgesInPath.push(edge.type);
      dfs(edge.to, path, edgesInPath);
      edgesInPath.pop();
    }

    path.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const nodeId of Object.keys(graph.nodes)) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, [], []);
    }
  }

  for (const [nodeId, code] of cycleIssues.entries()) {
    issues.push({ code, severity: "error", nodeId, message: `Cycle detected including ${nodeId}.` });
  }
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
