import type { GraphRevision } from "@manyhands/task-graph";

export type ReadinessReason =
  | { code: "missing_artifact"; artifactId: string; requiredRevision: string }
  | { code: "stale_contract"; contractId: string; requiredRevision: string; currentRevision?: string }
  | { code: "unresolved_decision"; decisionId: string }
  | { code: "unmaterializable_base" }
  | { code: "active_resource_constraint" }
  | { code: "budget_exhausted" }
  | { code: "executor_unavailable" }
  | { code: "already_adopted" };

export interface ReadinessStateV2 {
  adoptedArtifacts: Array<{ artifactId: string; revision: string; digest: string }>;
  pendingDecisions: Array<{ decisionId: string; affectedNodeIds: string[] }>;
  materializableNodeIds: string[];
  activeResourceNodeIds: string[];
  budgetAvailable: boolean;
  availableExecutorNodeIds: string[];
  adoptedNodeIds: string[];
  currentContractRevisions: Record<string, string>;
  requiredContractRevisions?: Record<string, Array<{ id: string; revision: string }>>;
}

export interface ReadinessInputV2 extends ReadinessStateV2 { graph: GraphRevision; nodeId: string; }
export interface ReadinessExplanationV2 { nodeId: string; ready: boolean; reasons: ReadinessReason[]; deferred?: boolean; }
