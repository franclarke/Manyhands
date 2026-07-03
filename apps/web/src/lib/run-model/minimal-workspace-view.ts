import { buildDecisionChannelView, type DecisionChannelItem } from "./decision-channel-view";
import { selectWorkspaceView, type WorkspaceNode, type WorkspaceView } from "./workspace-view";
import type { RunHealth, RunModel, RunPhase } from "./types";

export type ProductStage = "intent" | "proposal" | "running" | "review";

export interface MinimalRunGraph {
  nodes: WorkspaceNode[];
  edges: WorkspaceView["edges"];
  wavefront: string[];
}

export interface MinimalReviewEvidence {
  tests: { pass: number; total: number };
  aggregateDiffRef: string;
  narrativeRef: string;
  integrationCommit: string;
}

export interface MinimalWorkspaceView {
  stage: ProductStage;
  phase: RunPhase;
  health: RunHealth;
  title: string;
  statusLine: string;
  graph: MinimalRunGraph;
  primaryAttention: DecisionChannelItem | null;
  pendingAttentionCount: number;
  reviewEvidence: MinimalReviewEvidence | null;
  details: WorkspaceView;
}

export function selectMinimalWorkspaceView(model: RunModel): MinimalWorkspaceView {
  const details = selectWorkspaceView(model);
  const channel = buildDecisionChannelView(model);
  const stage = productStageFor(details.phase);
  const primaryAttention = channel.items[0] ?? null;
  const title = titleFor(details);

  return {
    stage,
    phase: details.phase,
    health: details.health,
    title,
    statusLine: statusLineFor(details, primaryAttention),
    graph: {
      nodes: details.nodes,
      edges: details.edges,
      wavefront: details.wavefront
    },
    primaryAttention,
    pendingAttentionCount: channel.items.length,
    reviewEvidence: details.evidence,
    details
  };
}

function productStageFor(phase: RunPhase): ProductStage {
  switch (phase) {
    case "framing":
      return "intent";
    case "proposal":
      return "proposal";
    case "disposition":
      return "review";
    case "foundation":
    case "supervision":
    case "reconciliation":
    default:
      return "running";
  }
}

function titleFor(view: WorkspaceView): string {
  const root = view.nodes.find((node) => node.role === "root");
  return root?.title ?? view.intent;
}

function statusLineFor(view: WorkspaceView, attention: DecisionChannelItem | null): string {
  if (attention !== null) {
    return attention.blocking
      ? `${attention.label}: ${attention.summary}`
      : `Hay una sugerencia disponible: ${attention.label}`;
  }
  switch (view.phase) {
    case "framing":
      return "Preparando el contexto del repositorio.";
    case "proposal":
      return "El sistema propuso un plan. Revisalo en el grafo y aprobalo para ejecutar.";
    case "foundation":
      return "Convirtiendo el plan en una base ejecutable.";
    case "supervision":
      return view.wavefront.length > 0
        ? `${view.wavefront.length} tareas avanzando en paralelo.`
        : "Los agentes están ejecutando el plan.";
    case "reconciliation":
      return view.conflicts.length > 0
        ? "Integrando resultados y aislando conflictos."
        : "Integrando los resultados de los agentes.";
    case "disposition":
      return view.evidence !== null
        ? `Evidencia lista: tests ${view.evidence.tests.pass}/${view.evidence.tests.total}.`
        : "Preparando la evidencia final.";
    default:
      return "Run en progreso.";
  }
}
