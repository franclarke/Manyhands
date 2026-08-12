import type { LegacyGraphRevisionV2 } from "@manyhands/task-graph";

export type ReadinessReason =
  | { code: "missing_artifact"; artifactId: string; requiredRevision: string }
  | { code: "stale_contract"; contractId: string; requiredRevision: string; currentRevision?: string }
  | { code: "unresolved_decision"; decisionId: string }
  | { code: "unmaterializable_base" }
  | { code: "active_resource_constraint" }
  | { code: "budget_exhausted" }
  | { code: "executor_unavailable" }
  | { code: "circuit_breaker_open" }
  | { code: "branch_stopped" }
  | { code: "already_adopted" };

export interface ReadinessStateV2 {
  adoptedArtifacts: Array<{ artifactId: string; revision: string; digest: string }>;
  pendingDecisions: Array<{ decisionId: string; affectedNodeIds: string[] }>;
  materializableNodeIds: string[];
  activeResourceNodeIds: string[];
  budgetAvailable: boolean;
  openCircuitBreakerNodeIds?: string[];
  stoppedNodeIds?: string[];
  availableExecutorNodeIds: string[];
  adoptedNodeIds: string[];
  currentContractRevisions: Record<string, string>;
  requiredContractRevisions?: Record<string, Array<{ id: string; revision: string }>>;
}

export interface ReadinessInputV2 extends ReadinessStateV2 { graph: LegacyGraphRevisionV2; nodeId: string; }
export interface ReadinessExplanationV2 { nodeId: string; ready: boolean; reasons: ReadinessReason[]; deferred?: boolean; }
