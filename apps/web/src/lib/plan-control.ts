import type { RunSnapshot } from "@manyhands/core";
import type { RunControlStatus } from "@/lib/run-model/types";

export interface PlanControlExecutorSelection {
  executorId: string;
  model: string;
}

export interface PlanControlNodeReview {
  status: "approved" | "changes_requested";
  at: string;
  feedback?: string;
}

export interface PlanControlNode {
  id: string;
  parentId: string | null;
  kind: "root" | "composite" | "leaf" | "integrator";
  title: string;
  objective: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  acceptanceCriteria: string[];
  manual: boolean;
  executorSelection: PlanControlExecutorSelection | null;
  review: PlanControlNodeReview | null;
}

export interface PlanControlDependency {
  fromTaskId: string;
  toTaskId: string;
  type: "contractual" | "structural" | "logical";
  inferred: boolean;
  rationale?: string;
}

export interface PlanControlRisk {
  taskIds: [string, string];
  level: "low" | "medium" | "high" | "blocking";
  score: number;
  recommendation: "run_parallel" | "serialize" | "add_dependency" | "requires_human_review";
  explanation: string;
  sharedFiles: string[];
  acknowledged: boolean;
  acknowledgedReason?: string;
  suggestedDependency?: {
    fromTaskId: string;
    toTaskId: string;
    reason: string;
  };
}

export interface PlanControlPlane {
  version: number;
  status: RunControlStatus;
  routing: "fixed" | "complexity";
  editable: boolean;
  canRunManualNodes: boolean;
  canFork: boolean;
  nodes: PlanControlNode[];
  dependencies: PlanControlDependency[];
  risks: PlanControlRisk[];
}

export function buildPlanControlPlane(
  snapshot: RunSnapshot | null,
  input: {
    version: number;
    status: RunControlStatus;
    routing: "fixed" | "complexity";
    nodeReviews?: Record<string, PlanControlNodeReview>;
  }
): PlanControlPlane | null {
  if (snapshot === null) return null;

  const contracts = new Map(snapshot.contracts.map((contract) => [contract.taskId, contract]));
  const nodes = Object.values(snapshot.graphSnapshot.nodes)
    .map((node): PlanControlNode => {
      const contract = contracts.get(node.id) ?? node.contract;
      return {
        id: node.id,
        parentId: node.parentId,
        kind: node.kind,
        title: node.title,
        objective: contract?.objective ?? node.goal,
        allowedPaths: [...(contract?.allowed.paths ?? [])],
        forbiddenPaths: [...(contract?.forbidden.paths ?? contract?.forbiddenPaths ?? [])],
        acceptanceCriteria: contract?.acceptance.map((criterion) => criterion.description)
          ?? [...(node.acceptanceCriteria ?? [])],
        manual: node.metadata?.authoredBy === "human",
        executorSelection: readExecutorSelection(node.metadata?.executorSelection)
          ?? readExecutorSelection(node.metadata?.executorOverride)
          ?? null,
        review: input.nodeReviews?.[node.id] ?? null
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  const risks = snapshot.riskPredictions.map((risk): PlanControlRisk => {
    const augmented = risk as typeof risk & {
      acknowledged?: boolean;
      acknowledgedReason?: string;
    };
    return {
      taskIds: [risk.taskAId, risk.taskBId],
      level: risk.level,
      score: risk.score,
      recommendation: risk.recommendation,
      explanation: risk.explanation,
      sharedFiles: [...risk.sharedFiles],
      acknowledged: augmented.acknowledged === true,
      ...(augmented.acknowledgedReason !== undefined
        ? { acknowledgedReason: augmented.acknowledgedReason }
        : {}),
      ...(risk.suggestedDependency !== undefined
        ? { suggestedDependency: { ...risk.suggestedDependency } }
        : {})
    };
  });

  return {
    version: input.version,
    status: input.status,
    routing: input.routing,
    editable: input.status === "needs_review" || input.status === "approved",
    canRunManualNodes: input.status === "approved",
    canFork: [
      "created",
      "paused",
      "needs_review",
      "approved",
      "interrupted",
      "completed",
      "completed_with_accepted",
      "failed"
    ].includes(input.status),
    nodes,
    dependencies: snapshot.graphSnapshot.dependencies.map((dependency) => ({
      fromTaskId: dependency.fromTaskId,
      toTaskId: dependency.toTaskId,
      type: dependency.type,
      inferred: dependency.inferred,
      ...(dependency.rationale !== undefined ? { rationale: dependency.rationale } : {})
    })),
    risks
  };
}

function readExecutorSelection(value: unknown): PlanControlExecutorSelection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as { executorId?: unknown; model?: unknown };
  if (typeof candidate.executorId !== "string" || typeof candidate.model !== "string") return undefined;
  return { executorId: candidate.executorId, model: candidate.model };
}
