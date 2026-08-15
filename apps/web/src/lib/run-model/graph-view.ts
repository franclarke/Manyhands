import { GraphRevisionSchema } from "@manyhands/task-graph";
import { LegacyGraphRevisionV2Schema } from "@manyhands/task-graph";

/**
 * The graph the workspace renders, derived from a journal fact.
 *
 * This is the UI's own type on purpose. The canonical `GraphRevision` and the
 * historical V2 revision disagree about which relations exist and what they
 * carry, and the renderer needs one shape. Every field here comes from one of
 * those two records; nothing is defaulted into existence, which is why the
 * optional fields are optional rather than filled with a plausible value.
 */
export interface RunGraphNodeView {
  id: string;
  parentId: string | null;
  kind: "root" | "composite" | "leaf" | "integrator";
  title: string;
  goal: string;
  /** Presentational banding only; absent on canonical revisions. */
  topologicalLevel?: number | undefined;
}

export interface RunGraphArtifactEdge {
  id: string;
  producerNodeId: string;
  consumerNodeId: string;
  contractId: string;
  contractRevision: string;
  /** V2 only: which phase required the artifact. */
  requiredFor?: "execution" | "validation" | "integration" | undefined;
  /** Canonical only: the input name the consumer binds it to. */
  consumerInputName?: string | undefined;
}

export interface RunGraphSeamEdge {
  id: string;
  producerNodeId: string;
  consumerNodeId: string;
  contractId: string;
  contractRevision: string;
  /** V2 only. */
  producerRevision?: string | undefined;
  consumerRevision?: string | undefined;
  /** Canonical only: the obligations that prove the seam holds. */
  validationObligationIds?: readonly string[] | undefined;
}

export interface RunGraphConflictEdge {
  id: string;
  leftNodeId: string;
  rightNodeId: string;
  reason: string;
  risk: "low" | "medium" | "high";
}

export type RunGraphSource = "canonical" | "legacy" | "provisional";

export interface RunGraphView {
  source: RunGraphSource;
  graphId: string;
  revision: number;
  rootId: string;
  nodes: Record<string, RunGraphNodeView>;
  artifactEdges: RunGraphArtifactEdge[];
  seamEdges: RunGraphSeamEdge[];
  /**
   * Empty on canonical revisions. Stage 9 replaced pairwise conflict
   * constraints with resource claims, so a canonical graph has none to show and
   * the lens is honestly empty rather than populated from somewhere else.
   */
  conflictEdges: RunGraphConflictEdge[];
}

/** The graph the daemon compiles today. */
export function canonicalGraphView(value: unknown): RunGraphView | null {
  const parsed = GraphRevisionSchema.safeParse(value);
  if (!parsed.success) return null;
  const graph = parsed.data;
  return {
    source: "canonical",
    graphId: graph.graphId,
    revision: graph.revision,
    rootId: graph.rootId,
    nodes: Object.fromEntries(Object.entries(graph.nodes).map(([id, node]) => [id, {
      id: node.id,
      parentId: node.parentId,
      kind: node.kind,
      title: node.title,
      goal: node.goal
    }])),
    artifactEdges: graph.artifactRequirements.map((relation) => ({
      id: relation.id,
      producerNodeId: relation.producerNodeId,
      consumerNodeId: relation.consumerNodeId,
      contractId: relation.artifactContract.id,
      contractRevision: String(relation.artifactContract.revision),
      consumerInputName: relation.consumerInputName
    })),
    seamEdges: graph.seamBindings.map((relation) => ({
      id: relation.id,
      producerNodeId: relation.producerNodeId,
      consumerNodeId: relation.consumerNodeId,
      contractId: relation.seamContract.id,
      contractRevision: String(relation.seamContract.revision),
      validationObligationIds: relation.validationObligationIds
    })),
    conflictEdges: []
  };
}

/** Journals recorded before the canonical revision; read-only history. */
export function legacyGraphView(value: unknown): RunGraphView | null {
  const parsed = LegacyGraphRevisionV2Schema.safeParse(value);
  if (!parsed.success) return null;
  const graph = parsed.data;
  return {
    source: "legacy",
    graphId: graph.graphId,
    revision: graph.revision,
    rootId: graph.rootId,
    nodes: Object.fromEntries(Object.entries(graph.nodes).map(([id, node]) => [id, {
      id: node.id,
      parentId: node.parentId,
      kind: node.kind,
      title: node.title,
      goal: node.goal,
      ...(node.topologicalLevel === undefined ? {} : { topologicalLevel: node.topologicalLevel })
    }])),
    artifactEdges: graph.artifactRequirements.map((relation) => ({
      id: relation.id,
      producerNodeId: relation.producerNodeId,
      consumerNodeId: relation.consumerNodeId,
      contractId: relation.artifactContract.id,
      contractRevision: relation.artifactContract.revision,
      requiredFor: relation.requiredFor
    })),
    seamEdges: graph.seamBindings.map((relation) => ({
      id: relation.id,
      producerNodeId: relation.producerNodeId,
      consumerNodeId: relation.consumerNodeId,
      contractId: relation.seamContract.id,
      contractRevision: relation.seamContract.revision,
      producerRevision: relation.producerRevision,
      consumerRevision: relation.consumerRevision
    })),
    conflictEdges: graph.conflictConstraints.map((relation) => ({
      id: relation.id,
      leftNodeId: relation.leftNodeId,
      rightNodeId: relation.rightNodeId,
      reason: relation.reason,
      risk: relation.risk
    }))
  };
}

/** True while the graph on screen is not yet a compiled fact. */
export function isProvisional(graph: RunGraphView | null): boolean {
  return graph?.source === "provisional";
}
