import type { GranularityProjection } from "@manyhands/run-coordinator";
import type { GraphRevision } from "@manyhands/task-graph";

import type { RunNodeView } from "@/lib/run-model/types";

export type GraphLens = "execution" | "artifact" | "contract" | "conflict" | "all";
export type GraphRelationKind = "hierarchy" | "artifact" | "contract" | "conflict";

export type GraphRelationDetail =
  | {
      id: string;
      kind: "artifact";
      contractId: string;
      contractRevision: string;
      requiredFor: "execution" | "validation" | "integration";
    }
  | {
      id: string;
      kind: "contract";
      contractId: string;
      contractRevision: string;
      producerRevision: string;
      consumerRevision: string;
    }
  | {
      id: string;
      kind: "conflict";
      reason: string;
      risk: "low" | "medium" | "high";
    };

export interface GraphRelationView {
  id: string;
  source: string;
  target: string;
  kind: GraphRelationKind;
  relationCount: number;
  details: GraphRelationDetail[];
}

interface SecondaryRelation {
  id: string;
  source: string;
  target: string;
  kind: Exclude<GraphRelationKind, "hierarchy">;
  detail: GraphRelationDetail;
}

export function buildRelationViews(
  graph: GraphRevision,
  lens: GraphLens,
  selectedNodeId: string | null
): GraphRelationView[] {
  const hierarchy = Object.values(graph.nodes)
    .filter((node) => node.parentId !== null)
    .map((node): GraphRelationView => ({
      id: `hierarchy:${node.parentId}:${node.id}`,
      source: node.parentId!,
      target: node.id,
      kind: "hierarchy",
      relationCount: 1,
      details: []
    }));

  const secondary = secondaryRelations(graph).filter((relation) => {
    if (lens === "execution") {
      return selectedNodeId !== null && (relation.source === selectedNodeId || relation.target === selectedNodeId);
    }
    return lens === "all" || relation.kind === lens;
  });

  return [...hierarchy, ...bundleSecondaryRelations(secondary)];
}

export function relationNeighborhood(relations: readonly GraphRelationView[], selectedNodeId: string | null): Set<string> {
  if (selectedNodeId === null) return new Set();
  const visible = new Set([selectedNodeId]);
  for (const relation of relations) {
    if (relation.source === selectedNodeId) visible.add(relation.target);
    if (relation.target === selectedNodeId) visible.add(relation.source);
  }
  return visible;
}

export function relationLaneOffset(kind: GraphRelationKind): number {
  switch (kind) {
    case "artifact": return 18;
    case "contract": return 36;
    case "conflict": return 54;
    default: return 0;
  }
}

export function bundledArtifactDeliveries(graph: GraphRevision, nodeId: string): number {
  return graph.artifactRequirements.filter((relation) => (
    relation.consumerNodeId === nodeId && isAncestorOf(graph, nodeId, relation.producerNodeId)
  )).length;
}

export function summarizeRunNodes(nodes: readonly RunNodeView[]): {
  executableCount: number;
  completedExecutables: number;
  activeAgents: number;
  blockedAgents: number;
  coordinatingNodes: number;
} {
  const executableNodes = nodes.filter((node) => node.kind === "leaf");
  const coordinatingNodes = nodes.filter((node) => node.kind !== "leaf" && node.status === "running").length;
  return {
    executableCount: executableNodes.length,
    completedExecutables: executableNodes.filter((node) => node.status === "succeeded").length,
    activeAgents: executableNodes.filter((node) => node.status === "running").length,
    blockedAgents: executableNodes.filter((node) => node.status === "waiting").length,
    coordinatingNodes
  };
}

export function eventPresentation(type: string): { label: string; diagnostic: boolean } {
  const labels: Record<string, string> = {
    "run.created": "Objetivo registrado",
    "repository.inspected": "Repositorio comprendido",
    "planning.attempt_started": "Planificación iniciada",
    "planning.node_discovered": "Nodo identificado",
    "planning.critic_recorded": "Revisión del plan registrada",
    "planning.attempt_failed": "Intento de planificación descartado",
    "planning.failed": "Planificación fallida",
    "planning.completed": "Trabajo desglosado",
    "graph.compiled": "Grafo y contratos compilados",
    "graph.revision.proposed": "Revisión del grafo propuesta",
    "graph.revision.approved": "Plan aprobado",
    "readiness.observed": "Disponibilidad recalculada",
    "wave.selected": "Nueva ola de trabajo",
    "attempt.started": "Agente iniciado",
    "attempt.candidate_created": "Cambio candidato creado",
    "attempt.failed": "Intento fallido",
    "validation.completed": "Validación completada",
    "failure.classified": "Fallo clasificado",
    "artifact.adopted": "Artefacto adoptado",
    "integration.started": "Integración iniciada",
    "integration.completed": "Integración completada",
    "decision.raised": "Decisión solicitada",
    "decision.resolved": "Decisión respondida",
    "final_candidate.verified": "Resultado final verificado",
    "delivery.published": "Resultado publicado",
    "run.failed": "Run fallido"
  };
  const diagnosticTypes = new Set([
    "planning.node_discovered",
    "planning.critic_recorded",
    "graph.revision.proposed",
    "readiness.observed",
    "failure.classified"
  ]);
  return {
    label: labels[type] ?? humanizeEventType(type),
    diagnostic: diagnosticTypes.has(type)
  };
}

function secondaryRelations(graph: GraphRevision): SecondaryRelation[] {
  return [
    ...graph.artifactRequirements
      .filter((relation) => !isAncestorOf(graph, relation.consumerNodeId, relation.producerNodeId))
      .map((relation) => ({
      id: relation.id,
      source: relation.producerNodeId,
      target: relation.consumerNodeId,
      kind: "artifact" as const,
      detail: {
        id: relation.id,
        kind: "artifact" as const,
        contractId: relation.artifactContract.id,
        contractRevision: relation.artifactContract.revision,
        requiredFor: relation.requiredFor
      }
      })),
    ...graph.seamBindings.map((relation) => ({
      id: relation.id,
      source: relation.producerNodeId,
      target: relation.consumerNodeId,
      kind: "contract" as const,
      detail: {
        id: relation.id,
        kind: "contract" as const,
        contractId: relation.seamContract.id,
        contractRevision: relation.seamContract.revision,
        producerRevision: relation.producerRevision,
        consumerRevision: relation.consumerRevision
      }
    })),
    ...graph.conflictConstraints.map((relation) => ({
      id: relation.id,
      source: relation.leftNodeId,
      target: relation.rightNodeId,
      kind: "conflict" as const,
      detail: {
        id: relation.id,
        kind: "conflict" as const,
        reason: relation.reason,
        risk: relation.risk
      }
    }))
  ];
}

function isAncestorOf(graph: GraphRevision, ancestorId: string, nodeId: string): boolean {
  let current = graph.nodes[nodeId]?.parentId ?? null;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = graph.nodes[current]?.parentId ?? null;
  }
  return false;
}

function bundleSecondaryRelations(relations: readonly SecondaryRelation[]): GraphRelationView[] {
  const byPair = new Map<string, GraphRelationView>();
  for (const relation of relations) {
    const pair = relation.kind === "conflict"
      ? [relation.source, relation.target].sort()
      : [relation.source, relation.target];
    const key = `relations:${relation.kind}:${pair[0]}:${pair[1]}`;
    const existing = byPair.get(key);
    if (existing === undefined) {
      byPair.set(key, {
        id: key,
        source: relation.source,
        target: relation.target,
        kind: relation.kind,
        relationCount: 1,
        details: [relation.detail]
      });
      continue;
    }
    existing.relationCount += 1;
    existing.details.push(relation.detail);
  }
  return [...byPair.values()];
}

function humanizeEventType(type: string): string {
  const words = type.replaceAll("_", " ").replaceAll(".", " · ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface GranularityDimensionView {
  label: string;
  value: number;
  weight: number;
}

export interface GranularityExplanationView {
  decisionLabel: string;
  score: number;
  threshold: number;
  /** Reads as "C_task 0.78 ≤ 3.5" so the decision is legible at a glance. */
  comparison: string;
  dimensions: GranularityDimensionView[];
  signalSourceLabel: string;
  rationale: string;
  formulaVersion: string;
  branchingFactor?: number;
}

const GRANULARITY_DIMENSION_LABELS: ReadonlyArray<{ key: keyof GranularityProjection["weights"]; label: string }> = [
  { key: "scopeRadius", label: "Radio de alcance" },
  { key: "interfaceImpact", label: "Impacto de interfaz" },
  { key: "validationSurface", label: "Superficie de validación" },
  { key: "contextTokenMass", label: "Masa de contexto" }
];

const SIGNAL_SOURCE_LABELS: Record<"llm" | "clamped" | "derived", string> = {
  llm: "estimadas por el planner",
  clamped: "ajustadas contra el repositorio",
  derived: "derivadas del alcance declarado"
};

/**
 * Turns the persisted C_task evidence into the human explanation of why a node
 * became a leaf or a composite. It never re-derives the policy: every number
 * comes from the `planning.granularity_assessed` domain event.
 */
export function granularityExplanation(
  granularity: GranularityProjection | undefined,
  nodeId: string | null
): GranularityExplanationView | null {
  if (granularity === undefined || nodeId === null) return null;
  const assessment = granularity.assessments[nodeId];
  if (assessment === undefined) return null;
  const isLeaf = assessment.decision === "leaf";
  return {
    decisionLabel: isLeaf ? "Hoja cohesiva" : "Compuesto",
    score: assessment.complexityScore,
    threshold: granularity.leafThreshold,
    comparison: `C_task ${assessment.complexityScore} ${isLeaf ? "≤" : ">"} ${granularity.leafThreshold}`,
    dimensions: GRANULARITY_DIMENSION_LABELS.map(({ key, label }) => ({
      label,
      value: assessment.dimensions[key],
      weight: granularity.weights[key]
    })),
    signalSourceLabel: SIGNAL_SOURCE_LABELS[assessment.signalSource],
    rationale: assessment.rationale,
    formulaVersion: granularity.formulaVersion,
    ...(assessment.recommendedBranchingFactor === undefined ? {} : { branchingFactor: assessment.recommendedBranchingFactor })
  };
}
