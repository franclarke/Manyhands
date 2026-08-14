import type {
  ResourceClaim,
  RuntimeLeaseClaim,
  TaskContractBundle
} from "@manyhands/contracts";
import type { GraphRevision, ResourceOverlap } from "@manyhands/task-graph";

export interface CanonicalAdoptedArtifact {
  artifactId: string;
  revision: number;
  digest: string;
}

export interface CanonicalPendingDecision {
  decisionId: string;
  affectedNodeIds: readonly string[];
}

export interface CanonicalReadinessSnapshot {
  graph: GraphRevision;
  contracts: { taskBundles: Readonly<Record<string, TaskContractBundle>> };
  adoptedArtifacts: readonly CanonicalAdoptedArtifact[];
  pendingDecisions: readonly CanonicalPendingDecision[];
  activeNodeIds: readonly string[];
  activeResourceClaims?: readonly ResourceClaim[];
  activeRuntimeLeases: readonly RuntimeLeaseClaim[];
  availableExecutorNodeIds: readonly string[];
  adoptedNodeIds: readonly string[];
  budgetAvailable: boolean;
  currentContractDigests?: Readonly<Record<string, string>>;
  resourceOverlap?: (leftResourceId: string, rightResourceId: string) => ResourceOverlap;
}

export type CanonicalReadinessReason =
  | { code: "missing_artifact"; artifactId: string; revision: number }
  | { code: "stale_contract"; contractId: string }
  | { code: "unresolved_decision"; decisionId: string }
  | { code: "resource_overlap_unknown"; resourceId: string; activeNodeId: string }
  | { code: "resource_claim_conflict"; resourceId: string; activeNodeId: string }
  | { code: "runtime_lease_conflict"; provider: string; resourceKey: string; activeNodeId: string }
  | { code: "executor_unavailable" }
  | { code: "budget_exhausted" }
  | { code: "already_active" }
  | { code: "already_adopted" };

export interface CanonicalReadinessExplanation {
  nodeId: string;
  ready: boolean;
  reasons: CanonicalReadinessReason[];
}

export interface CanonicalReadinessEvaluation {
  ready: CanonicalReadinessExplanation[];
  blocked: CanonicalReadinessExplanation[];
}

export interface IntegrationRiskEstimate {
  score: number;
  evidenceRefs: readonly string[];
}

export interface CanonicalSelectionPolicy {
  maxParallel: number;
  maxConcurrentRiskScore?: number;
}

export interface CanonicalFrontierSelection {
  selected: CanonicalReadinessExplanation[];
  deferred: Array<{
    nodeId: string;
    reason: "capacity" | "integration_risk_concurrency" | "resource_claim_conflict" | "runtime_lease_conflict";
    risk?: IntegrationRiskEstimate;
  }>;
}

/**
 * Evaluates only hard, explainable preconditions over the canonical graph.
 * Integration risk deliberately has no input here: it cannot make work valid,
 * invalid, or change its authority.
 */
export function evaluateReadiness(input: CanonicalReadinessSnapshot): CanonicalReadinessEvaluation {
  const activeNodeIds = new Set(input.activeNodeIds);
  const adoptedNodeIds = new Set(input.adoptedNodeIds);
  const availableExecutors = new Set(input.availableExecutorNodeIds);
  const activeClaims = input.activeResourceClaims ?? input.graph.resourceClaims.filter((claim) =>
    activeNodeIds.has(claim.nodeId)
  );
  const activeLeases = input.activeRuntimeLeases;
  const explanations = Object.keys(input.graph.nodes)
    .sort((left, right) => left.localeCompare(right))
    .map((nodeId) => explainNode(nodeId, input, {
      activeNodeIds,
      adoptedNodeIds,
      availableExecutors,
      activeClaims,
      activeLeases
    }));
  return {
    ready: explanations.filter(({ ready }) => ready),
    blocked: explanations.filter(({ ready }) => !ready)
  };
}

/**
 * Ranks an already-ready set. The estimator is evaluated lazily against the
 * small selected set; it is never used by evaluateReadiness.
 */
export function selectFrontier(input: {
  ready: readonly CanonicalReadinessExplanation[];
  policy: CanonicalSelectionPolicy;
  graph?: GraphRevision;
  estimateIntegrationRisk(
    candidate: CanonicalReadinessExplanation,
    selected: readonly CanonicalReadinessExplanation[]
  ): IntegrationRiskEstimate;
}): CanonicalFrontierSelection {
  if (!Number.isInteger(input.policy.maxParallel) || input.policy.maxParallel < 1) {
    throw new Error("SelectionPolicy.maxParallel must be a positive integer.");
  }
  const threshold = input.policy.maxConcurrentRiskScore ?? 50;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error("SelectionPolicy.maxConcurrentRiskScore must be non-negative.");
  }
  const selected: CanonicalReadinessExplanation[] = [];
  const deferred: CanonicalFrontierSelection["deferred"] = [];
  for (const candidate of [...input.ready].filter(({ ready }) => ready)
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId))) {
    if (selected.length >= input.policy.maxParallel) {
      deferred.push({ nodeId: candidate.nodeId, reason: "capacity" });
      continue;
    }
    const hardConflict = input.graph === undefined ? undefined : concurrentHardConflict(candidate.nodeId, selected.map(({ nodeId }) => nodeId), input.graph);
    if (hardConflict !== undefined) {
      deferred.push({ nodeId: candidate.nodeId, reason: hardConflict });
      continue;
    }
    const risk = normalizeRisk(input.estimateIntegrationRisk(candidate, selected));
    if (selected.length > 0 && risk.score > threshold) {
      deferred.push({ nodeId: candidate.nodeId, reason: "integration_risk_concurrency", risk });
      continue;
    }
    selected.push(candidate);
  }
  return { selected, deferred };
}

function explainNode(
  nodeId: string,
  input: CanonicalReadinessSnapshot,
  state: {
    activeNodeIds: ReadonlySet<string>;
    adoptedNodeIds: ReadonlySet<string>;
    availableExecutors: ReadonlySet<string>;
    activeClaims: readonly ResourceClaim[];
    activeLeases: readonly RuntimeLeaseClaim[];
  }
): CanonicalReadinessExplanation {
  const reasons: CanonicalReadinessReason[] = [];
  const node = input.graph.nodes[nodeId];
  if (node === undefined) throw new Error(`Graph node ${nodeId} is missing.`);
  const currentDigest = input.currentContractDigests?.[node.contractRef.id];
  if (currentDigest !== undefined && currentDigest !== node.contractRef.digest) {
    reasons.push({ code: "stale_contract", contractId: node.contractRef.id });
  }
  if (!input.contracts.taskBundles[nodeId]) {
    reasons.push({ code: "stale_contract", contractId: node.contractRef.id });
  }
  for (const requirement of input.graph.artifactRequirements.filter((item) => item.consumerNodeId === nodeId)) {
    const adopted = input.adoptedArtifacts.some((artifact) =>
      artifact.artifactId === requirement.artifactContract.id &&
      artifact.revision === requirement.artifactContract.revision
    );
    if (!adopted) reasons.push({
      code: "missing_artifact",
      artifactId: requirement.artifactContract.id,
      revision: requirement.artifactContract.revision
    });
  }
  for (const decision of input.pendingDecisions) {
    if (decision.affectedNodeIds.includes(nodeId)) {
      reasons.push({ code: "unresolved_decision", decisionId: decision.decisionId });
    }
  }
  if (!state.availableExecutors.has(nodeId)) reasons.push({ code: "executor_unavailable" });
  if (!input.budgetAvailable) reasons.push({ code: "budget_exhausted" });
  if (state.activeNodeIds.has(nodeId)) reasons.push({ code: "already_active" });
  if (state.adoptedNodeIds.has(nodeId)) reasons.push({ code: "already_adopted" });
  appendResourceReasons(nodeId, input, state.activeClaims, reasons);
  appendLeaseReasons(nodeId, input.graph.runtimeLeaseClaims, state.activeLeases, reasons);
  return { nodeId, ready: reasons.length === 0, reasons };
}

function appendResourceReasons(
  nodeId: string,
  input: CanonicalReadinessSnapshot,
  activeClaims: readonly ResourceClaim[],
  reasons: CanonicalReadinessReason[]
): void {
  const nodeClaims = input.graph.resourceClaims.filter((claim) => claim.nodeId === nodeId);
  for (const claim of nodeClaims) for (const active of activeClaims) {
    if (claim.nodeId === active.nodeId || (claim.access !== "modify" && active.access !== "modify")) continue;
    const overlap = input.resourceOverlap?.(claim.resourceId, active.resourceId)
      ?? (claim.resourceId === active.resourceId
        ? "yes"
        : input.graph.nodes[active.nodeId] === undefined ? "unknown" : "no");
    if (overlap === "unknown") {
      reasons.push({ code: "resource_overlap_unknown", resourceId: claim.resourceId, activeNodeId: active.nodeId });
    } else if (overlap === "yes") {
      reasons.push({ code: "resource_claim_conflict", resourceId: claim.resourceId, activeNodeId: active.nodeId });
    }
  }
}

function concurrentHardConflict(
  candidateNodeId: string,
  selectedNodeIds: readonly string[],
  graph: GraphRevision
): "resource_claim_conflict" | "runtime_lease_conflict" | undefined {
  const selected = new Set(selectedNodeIds);
  const candidateClaims = graph.resourceClaims.filter((claim) => claim.nodeId === candidateNodeId);
  const selectedClaims = graph.resourceClaims.filter((claim) => selected.has(claim.nodeId));
  for (const claim of candidateClaims) for (const active of selectedClaims) {
    if (claim.access === "modify" || active.access === "modify") {
      if (claim.resourceId === active.resourceId) return "resource_claim_conflict";
    }
  }
  const candidateLeases = graph.runtimeLeaseClaims.filter((claim) => claim.nodeId === candidateNodeId);
  const selectedLeases = graph.runtimeLeaseClaims.filter((claim) => selected.has(claim.nodeId));
  for (const lease of candidateLeases) for (const active of selectedLeases) {
    if (lease.provider === active.provider && lease.resourceKey === active.resourceKey &&
        (lease.mode === "exclusive" || active.mode === "exclusive")) return "runtime_lease_conflict";
  }
  return undefined;
}

function appendLeaseReasons(
  nodeId: string,
  claims: readonly RuntimeLeaseClaim[],
  activeLeases: readonly RuntimeLeaseClaim[],
  reasons: CanonicalReadinessReason[]
): void {
  for (const claim of claims.filter((item) => item.nodeId === nodeId)) for (const active of activeLeases) {
    if (claim.nodeId === active.nodeId || claim.provider !== active.provider || claim.resourceKey !== active.resourceKey) continue;
    if (claim.mode === "shared" && active.mode === "shared") continue;
    reasons.push({
      code: "runtime_lease_conflict",
      provider: claim.provider,
      resourceKey: claim.resourceKey,
      activeNodeId: active.nodeId
    });
  }
}

function normalizeRisk(value: IntegrationRiskEstimate): IntegrationRiskEstimate {
  if (!Number.isFinite(value.score) || value.score < 0) {
    throw new Error("IntegrationRiskEstimate.score must be finite and non-negative.");
  }
  return { score: value.score, evidenceRefs: [...new Set(value.evidenceRefs)].sort() };
}
