import type { GranularityStrategyProjection } from "@manyhands/run-coordinator";
import type { RunGraphView } from "@/lib/run-model/graph-view";
import type { RunNodeView } from "@/lib/run-model/types";

export type GraphLens = "execution" | "artifact" | "contract" | "conflict" | "all";
export type GraphRelationKind = "hierarchy" | "artifact" | "contract" | "conflict";

export type GraphRelationDetail =
  | {
      id: string;
      kind: "artifact";
      contractId: string;
      contractRevision: string;
      // Present on historical revisions only; a canonical graph binds the
      // artifact to a named consumer input instead of a phase.
      requiredFor?: "execution" | "validation" | "integration" | undefined;
      consumerInputName?: string | undefined;
    }
  | {
      id: string;
      kind: "contract";
      contractId: string;
      contractRevision: string;
      producerRevision?: string | undefined;
      consumerRevision?: string | undefined;
      validationObligationIds?: readonly string[] | undefined;
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
  graph: RunGraphView,
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

export function bundledArtifactDeliveries(graph: RunGraphView, nodeId: string): number {
  return graph.artifactEdges.filter((relation) => (
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
    "planning.unit_unresolved": "Unidad sin resolver",
    "planning.failed": "Planificación fallida",
    "planning.completed": "Trabajo desglosado",
    "planning.granularity_strategy_selected": "Estrategia de granularidad seleccionada",
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

function secondaryRelations(graph: RunGraphView): SecondaryRelation[] {
  return [
    ...graph.artifactEdges
      .filter((relation) => !isAncestorOf(graph, relation.consumerNodeId, relation.producerNodeId))
      .map((relation) => ({
      id: relation.id,
      source: relation.producerNodeId,
      target: relation.consumerNodeId,
      kind: "artifact" as const,
      detail: {
        id: relation.id,
        kind: "artifact" as const,
        contractId: relation.contractId,
        contractRevision: relation.contractRevision,
        ...(relation.requiredFor === undefined ? {} : { requiredFor: relation.requiredFor }),
        ...(relation.consumerInputName === undefined ? {} : { consumerInputName: relation.consumerInputName })
      }
      })),
    ...graph.seamEdges.map((relation) => ({
      id: relation.id,
      source: relation.producerNodeId,
      target: relation.consumerNodeId,
      kind: "contract" as const,
      detail: {
        id: relation.id,
        kind: "contract" as const,
        contractId: relation.contractId,
        contractRevision: relation.contractRevision,
        ...(relation.producerRevision === undefined ? {} : { producerRevision: relation.producerRevision }),
        ...(relation.consumerRevision === undefined ? {} : { consumerRevision: relation.consumerRevision }),
        ...(relation.validationObligationIds === undefined ? {} : { validationObligationIds: relation.validationObligationIds })
      }
    })),
    ...graph.conflictEdges.map((relation) => ({
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

function isAncestorOf(graph: RunGraphView, ancestorId: string, nodeId: string): boolean {
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

/** One of the three reasons, and whether it carried this decision. */
export interface GranularityReasonView {
  label: string;
  holds: boolean;
  explanation: string;
}

export interface GranularityExplanationView {
  decisionLabel: string;
  reasons: GranularityReasonView[];
  rationale: string;
  policyVersion: string;
  evidenceRefs: string[];
}

const REASON_LABELS: ReadonlyArray<{
  key: "doesNotFit" | "runsInParallel" | "verifiableApart";
  label: string;
  explanation: string;
}> = [
  {
    key: "doesNotFit",
    label: "No entra en un intento",
    explanation: "La unidad excede lo que un agente puede sostener o producir de una vez."
  },
  {
    key: "runsInParallel",
    label: "Corre en paralelo",
    explanation: "Al menos dos hijos pueden empezar al mismo tiempo, así que partir gana tiempo."
  },
  {
    key: "verifiableApart",
    label: "Se verifica por separado",
    explanation: "Cada hijo posee un criterio que ningún hermano posee, así que un fallo no invalida al resto."
  }
];

/**
 * Explains why a node received its granularity, from the decision the run
 * recorded rather than by re-deriving the policy.
 *
 * The decision is no longer a number against a threshold: it is which of three
 * reasons held. Showing them as a checklist is the whole explanation, and it is
 * what the operator can argue with.
 */
export function granularityStrategyExplanation(
  strategy: GranularityStrategyProjection | undefined,
  nodeId: string | null
): GranularityExplanationView | null {
  if (strategy === undefined || nodeId === null) return null;
  const assessment = strategy.assessments[nodeId];
  if (assessment === undefined) return null;
  const decisionLabel = assessment.selected === "split"
    ? "División semántica"
    : assessment.selected === "semantic_replan"
      ? "Replan semántico"
      : "Unidad cohesiva";
  return {
    decisionLabel,
    reasons: REASON_LABELS.map(({ key, label, explanation }) => ({
      label,
      holds: assessment.reasons[key],
      explanation
    })),
    rationale: assessment.rationale,
    policyVersion: strategy.policyVersion,
    evidenceRefs: [...assessment.evidenceRefs]
  };
}
