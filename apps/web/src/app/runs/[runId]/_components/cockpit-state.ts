import type { GraphRelationKind } from "@/lib/run-model/presentation";

export const AUTO_FIT_ON_RUN_EVENT = false as const;

type AttemptLike = {
  attemptId: string;
  nodeId: string;
  status: "running" | "candidate" | "validated" | "adopted" | "failed" | "discarded" | "stale";
  candidateCommit?: string | undefined;
  failureReason?: string | undefined;
};

type IntegrationLike = {
  nodeId: string;
  status: "running" | "completed" | "failed" | "decision_required";
  candidateCommit?: string | undefined;
  evidenceMatrixId?: string | undefined;
  failureReason?: string | undefined;
};

type EvidenceMatrixLike = {
  matrixId?: unknown;
  candidateCommit?: unknown;
  outcome?: unknown;
  criteria?: unknown;
};

export type LifecycleMedal =
  | { state: "candidate"; badge: string; commit: string; detail?: undefined }
  | { state: "verified"; badge: string; commit?: string | undefined; detail?: undefined }
  | { state: "evidence_incomplete"; badge: "Evidencia incompleta"; commit?: string | undefined; detail?: undefined }
  | { state: "evidence_pending"; badge: "Evidencia pendiente"; commit?: string | undefined; detail?: undefined }
  | { state: "failed"; badge: "Falló"; detail: string; commit?: undefined }
  | { state: "stale"; badge: "Obsoleto"; detail?: undefined; commit?: undefined }
  | { state: "delivered"; badge: "Entregado"; detail?: undefined; commit?: string | undefined }
  | { state: "none"; badge: ""; detail?: undefined; commit?: undefined };

export function lifecycleMedalForNode(input: {
  nodeId: string;
  attempts: readonly AttemptLike[];
  integrations: readonly IntegrationLike[];
  evidenceMatrixId?: string | undefined;
  evidenceMatrices: readonly EvidenceMatrixLike[];
  delivered: boolean;
}): LifecycleMedal {
  const attempt = [...input.attempts].reverse().find((entry) => entry.nodeId === input.nodeId);
  const integration = [...input.integrations].reverse().find((entry) => entry.nodeId === input.nodeId);
  const commit = integration?.candidateCommit ?? attempt?.candidateCommit;
  const matrixId = integration?.evidenceMatrixId ?? input.evidenceMatrixId;

  if (input.delivered) {
    return { state: "delivered", badge: "Entregado", ...(commit === undefined ? {} : { commit }) };
  }
  if (integration?.status === "failed" || integration?.status === "decision_required" || attempt?.status === "failed" || attempt?.status === "discarded") {
    return {
      state: "failed",
      badge: "Falló",
      detail: integration?.failureReason ?? attempt?.failureReason ?? "El intento no produjo un resultado verificable."
    };
  }
  if (attempt?.status === "stale") return { state: "stale", badge: "Obsoleto" };

  const matrix = evidenceMatrixForIdentity(input.evidenceMatrices, { matrixId, candidateCommit: commit });
  if ((attempt?.status === "validated" || attempt?.status === "adopted" || integration?.status === "completed") && matrix?.outcome === "verified") {
    const criteria = Array.isArray(matrix.criteria) ? matrix.criteria : [];
    const passed = criteria.filter((criterion) => (
      isRecord(criterion) && criterion.status === "satisfied"
    )).length;
    return {
      state: "verified",
      badge: `Verificado · ${passed}/${criteria.length} criterios`,
      ...(commit === undefined ? {} : { commit })
    };
  }
  if (attempt?.status === "validated" || attempt?.status === "adopted" || integration?.status === "completed") {
    if (matrix?.outcome === "failed") {
      return { state: "failed", badge: "Falló", detail: "La validación no pasó." };
    }
    if (matrix?.outcome === "unverified") {
      return {
        state: "evidence_incomplete",
        badge: "Evidencia incompleta",
        ...(commit === undefined ? {} : { commit })
      };
    }
    return {
      state: "evidence_pending",
      badge: "Evidencia pendiente",
      ...(commit === undefined ? {} : { commit })
    };
  }
  if (attempt?.status === "candidate" && attempt.candidateCommit !== undefined) {
    const shortSha = attempt.candidateCommit.slice(0, 7);
    return { state: "candidate", badge: `Candidato · ${shortSha}`, commit: attempt.candidateCommit };
  }
  return { state: "none", badge: "" };
}

export function evidenceMatrixForIdentity(
  matrices: readonly EvidenceMatrixLike[],
  identity: { matrixId?: string | undefined; candidateCommit?: string | undefined }
): EvidenceMatrixLike | undefined {
  if (identity.matrixId === undefined || identity.candidateCommit === undefined) return undefined;
  return matrices.find((matrix) => (
    matrix.matrixId === identity.matrixId && matrix.candidateCommit === identity.candidateCommit
  ));
}

export function isFinalCandidateDeliverable(input: {
  lifecycle: string;
  finalCandidate?: { commit: string; evidenceMatrixId: string; evidenceEligible: boolean } | undefined;
  evidenceMatrices: readonly EvidenceMatrixLike[];
}): boolean {
  const candidate = input.finalCandidate;
  if (input.lifecycle !== "result_ready" || candidate?.evidenceEligible !== true) return false;
  return input.evidenceMatrices.some((matrix) => (
    matrix.matrixId === candidate.evidenceMatrixId
    && matrix.candidateCommit === candidate.commit
    && matrix.outcome === "verified"
  ));
}

export function affectedSubgraphNodeIds(
  nodes: readonly { id: string; parentId: string | null }[],
  affectedNodeIds: readonly string[]
): Set<string> {
  const blocked = new Set(affectedNodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId !== null && blocked.has(node.parentId) && !blocked.has(node.id)) {
        blocked.add(node.id);
        changed = true;
      }
    }
  }
  return blocked;
}

export function relationDisplayName(kind: GraphRelationKind): string {
  const names: Record<GraphRelationKind, string> = {
    hierarchy: "ParentOwnership",
    artifact: "Entrega de artefacto",
    contract: "Contrato de frontera",
    conflict: "Conflicto de recursos"
  };
  return names[kind];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
