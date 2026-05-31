import type { RunSnapshot } from "@manyhands/core";
import type { IntegrationResult } from "@manyhands/execution-core";

export type GraphEdgeKind = "dependency" | "risk" | "gate" | "unknown";

export type GraphNodeStatus =
  | "planned"
  | "ready"
  | "running"
  | "gated"
  | "done"
  | "failed"
  | "blocked"
  | "generating"
  | "needs_review"
  | "approved"
  | "integrated";

export type GraphRiskLevel = "low" | "medium" | "high" | "blocking";

export interface GraphNodeView {
  id: string;
  title: string;
  description: string;
  kind: string;
  status: GraphNodeStatus;
  phase?: string;
  depth?: number;
  parentId?: string | null;
  riskLevel?: GraphRiskLevel;
  expectedFiles?: string[];
  blockedReason?: string;
  durationMs?: number;
  costUsd?: number;
  gateRequired?: boolean;
  traceCount?: number;
  authoredBy?: "ai" | "human";
  manual?: boolean;
  integrator?: boolean;
}

export interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  riskLevel?: GraphRiskLevel;
  label?: string;
  acknowledged?: boolean;
}

export interface GraphStatusCounts {
  planned: number;
  ready: number;
  running: number;
  gated: number;
  done: number;
  failed: number;
  blocked: number;
  generating: number;
  needs_review: number;
  approved: number;
  integrated: number;
}

export interface RunGraphViewModel {
  runId: string;
  featureId: string;
  mode: string;
  schemaVersion: string;
  deterministic: boolean;
  benchmarkLabel?: string;
  configLabel?: string;
  createdAt?: string;
  completedAt?: string;
  outputHash?: string;
  inputHash?: string;
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  status: GraphStatusCounts;
  summary: {
    taskCount: number;
    leafCount: number;
    dependencyCount: number;
    riskCount: number;
    traceEventCount: number;
  };
}

export interface InspectorContract {
  objective: string;
  definitionOfDone: string;
  acceptanceCriteria: string[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  expectedFiles: string[];
  producedSymbols: string[];
  consumedSymbols: string[];
  relevantSymbols: string[];
  dependencies: string[];
  knownRisks: string[];
  maxDurationMs: number;
  maxCostUsd: number;
}

export interface InspectorRiskEvidence {
  pairTaskId: string;
  level: GraphRiskLevel;
  recommendation: string;
  explanation: string;
  sharedFiles: string[];
  sharedSymbols: string[];
  evidence: Array<{ signal: string; detail: string; weight: number }>;
}

export interface InspectorStaticSignal {
  id: string;
  type: string;
  severity: GraphRiskLevel;
  detail: string;
  pairTaskId?: string;
}

export interface InspectorTraceEvent {
  id: string;
  type: string;
  timestamp: string;
  actor: string;
  summary?: string;
}

export interface InspectorValidation {
  passed: boolean;
  checks: Array<{
    kind: string;
    passed: boolean;
    summary: string;
    durationMs: number;
  }>;
}

export interface InspectorRunResult {
  success: boolean;
  worktree: string;
  branch: string;
  changedFiles: string[];
  scopeViolations: string[];
  durationMs: number;
  costUsd: number;
  diff?: string;
}

export interface InspectorIntegrationChild {
  taskId: string;
  title: string;
  status: GraphNodeStatus;
  /** True when the child already has a recorded agent run result. */
  executed: boolean;
}

export interface InspectorIntegration {
  compositeTaskId: string;
  children: InspectorIntegrationChild[];
  /**
   * Real cherry-pick / conflict / Codex-repair evidence. Produced by the
   * execution core (Etapa 1); `undefined` today → the Integration tab renders an
   * explicit pending state instead of inventing data.
   */
  result?: IntegrationResult;
}

export interface InspectorView {
  taskId: string;
  title: string;
  goal: string;
  kind: string;
  status: GraphNodeStatus;
  depth?: number;
  contract?: InspectorContract;
  riskEvidence: InspectorRiskEvidence[];
  staticSignals: InspectorStaticSignal[];
  traceEvents: InspectorTraceEvent[];
  validation?: InspectorValidation;
  runResult?: InspectorRunResult;
  integration?: InspectorIntegration;
  blockedReason?: string;
  gateRequired: boolean;
  authoredBy?: "ai" | "human";
  manual: boolean;
  integrator: boolean;
}

type RiskLevel = RunSnapshot["riskPredictions"][number]["level"];

const riskRank: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  blocking: 3
};

const initialCounts: GraphStatusCounts = {
  planned: 0,
  ready: 0,
  running: 0,
  gated: 0,
  done: 0,
  failed: 0,
  blocked: 0,
  generating: 0,
  needs_review: 0,
  approved: 0,
  integrated: 0
};

export function toRunGraphViewModel(snapshot: RunSnapshot): RunGraphViewModel {
  const resultsByTaskId = new Map(snapshot.agentRunResults.map((result) => [result.taskId, result]));
  const blockedByTaskId = new Map(snapshot.blockedTasks.map((blocked) => [blocked.taskId, blocked]));
  const gateRequiredTasks = collectGateRequiredTasks(snapshot);
  const traceCountByTaskId = new Map<string, number>();
  for (const event of snapshot.traceEvents) {
    if (event.taskId !== undefined) {
      traceCountByTaskId.set(event.taskId, (traceCountByTaskId.get(event.taskId) ?? 0) + 1);
    }
  }
  const nodes: GraphNodeView[] = Object.values(snapshot.graphSnapshot.nodes)
    .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id))
    .map((node) => {
      const contract = snapshot.contracts.find((entry) => entry.taskId === node.id) ?? node.contract;
      const expectedFiles = contract?.expectedOutput.changedFiles ?? [];
      const blocked = blockedByTaskId.get(node.id);
      const result = resultsByTaskId.get(node.id);
      const status = statusForNode(snapshot, node.id, node.status, resultsByTaskId, blockedByTaskId);
      const view: GraphNodeView = {
        id: node.id,
        title: node.title,
        description: descriptionForNode(node, contract),
        kind: node.kind,
        status,
        phase: `depth-${node.depth}`,
        depth: node.depth,
        parentId: node.parentId,
        gateRequired: gateRequiredTasks.has(node.id),
        manual: authoredByForNode(node) === "human",
        integrator: node.metadata?.integrator === true
      };
      const authoredBy = authoredByForNode(node);
      if (authoredBy !== undefined) {
        view.authoredBy = authoredBy;
      }
      const riskLevel = highestRiskLevelForTask(snapshot, node.id);

      if (riskLevel !== undefined) {
        view.riskLevel = riskLevel;
      }

      if (expectedFiles.length > 0) {
        view.expectedFiles = expectedFiles;
      }

      if (blocked !== undefined) {
        view.blockedReason = blocked.reason;
      }

      if (result?.metrics?.durationMs !== undefined) {
        view.durationMs = result.metrics.durationMs;
      }

      if (result?.metrics?.costUsd !== undefined) {
        view.costUsd = result.metrics.costUsd;
      }

      const traceCount = traceCountByTaskId.get(node.id);
      if (traceCount !== undefined && traceCount > 0) {
        view.traceCount = traceCount;
      }

      return view;
    });
  const dependencyEdges: GraphEdgeView[] = snapshot.graphSnapshot.dependencies.map((dependency) => {
    const view: GraphEdgeView = {
      id: `dependency:${dependency.fromTaskId}:${dependency.toTaskId}`,
      source: dependency.fromTaskId,
      target: dependency.toTaskId,
      kind: "dependency",
      label: dependency.type
    };

    if (dependency.rationale !== undefined) {
      view.label = `${dependency.type}: ${dependency.rationale}`;
    }

    return view;
  });
  const riskEdges: GraphEdgeView[] = snapshot.riskPredictions.map((prediction) => {
    const acknowledged = acknowledgedRisk(prediction);
    return {
      id: `risk:${prediction.taskAId}:${prediction.taskBId}`,
      source: prediction.taskAId,
      target: prediction.taskBId,
      kind: "risk",
      riskLevel: prediction.level,
      label: acknowledged ? "acknowledged" : prediction.recommendation,
      acknowledged
    };
  });
  const gateEdges = snapshot.traceEvents
    .map(gateEdgeFromTraceEvent)
    .filter((edge): edge is GraphEdgeView => edge !== null);
  const status = nodes.reduce<GraphStatusCounts>((acc, node) => {
    acc[node.status] += 1;
    return acc;
  }, { ...initialCounts });

  const result: RunGraphViewModel = {
    runId: snapshot.runId,
    featureId: snapshot.featureId,
    mode: snapshot.decompositionMode,
    schemaVersion: snapshot.metadata.schemaVersion,
    deterministic: snapshot.metadata.deterministic,
    nodes,
    edges: [
      ...dependencyEdges,
      ...riskEdges,
      ...gateEdges
    ],
    status,
    summary: {
      taskCount: nodes.length,
      leafCount: nodes.filter((node) => node.kind === "leaf").length,
      dependencyCount: snapshot.graphSnapshot.dependencies.length,
      riskCount: snapshot.riskPredictions.length,
      traceEventCount: snapshot.traceEvents.length
    }
  };

  if (snapshot.metadata.createdAt !== undefined) {
    result.createdAt = snapshot.metadata.createdAt;
  }

  if (snapshot.metadata.completedAt !== undefined) {
    result.completedAt = snapshot.metadata.completedAt;
  }

  if (snapshot.metadata.outputHash !== undefined) {
    result.outputHash = snapshot.metadata.outputHash;
  }

  if (snapshot.metadata.inputHash !== undefined) {
    result.inputHash = snapshot.metadata.inputHash;
  }

  return result;
}

function descriptionForNode(
  node: RunSnapshot["graphSnapshot"]["nodes"][string],
  contract: RunSnapshot["contracts"][number] | undefined
): string {
  const objective = compactText(contract?.objective);
  if (objective.length > 0) {
    return objective;
  }
  const goal = compactText(node.goal);
  if (goal.length > 0) {
    return goal;
  }
  return compactText(node.title);
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildInspectorView(snapshot: RunSnapshot, taskId: string): InspectorView | null {
  const node = snapshot.graphSnapshot.nodes[taskId];

  if (node === undefined) {
    return null;
  }

  const contract = snapshot.contracts.find((entry) => entry.taskId === taskId) ?? node.contract;
  const result = snapshot.agentRunResults.find((entry) => entry.taskId === taskId);
  const blocked = snapshot.blockedTasks.find((entry) => entry.taskId === taskId);
  const resultsByTaskId = new Map(snapshot.agentRunResults.map((entry) => [entry.taskId, entry]));
  const blockedByTaskId = new Map(snapshot.blockedTasks.map((entry) => [entry.taskId, entry]));
  const status = statusForNode(snapshot, taskId, node.status, resultsByTaskId, blockedByTaskId);
  const gateRequiredTasks = collectGateRequiredTasks(snapshot);

  const inspector: InspectorView = {
    taskId,
    title: node.title,
    goal: descriptionForNode(node, contract),
    kind: node.kind,
    status,
    depth: node.depth,
    riskEvidence: snapshot.riskPredictions
      .filter((prediction) => prediction.taskAId === taskId || prediction.taskBId === taskId)
      .map((prediction) => {
        const pairTaskId = prediction.taskAId === taskId ? prediction.taskBId : prediction.taskAId;
        return {
          pairTaskId,
          level: prediction.level,
          recommendation: prediction.recommendation,
          explanation: prediction.explanation,
          sharedFiles: [...prediction.sharedFiles],
          sharedSymbols: [...prediction.sharedSymbols],
          evidence: prediction.evidence.map((entry) => ({
            signal: entry.signal,
            detail: entry.detail,
            weight: entry.weight
          }))
        };
      }),
    staticSignals: snapshot.staticConflictSignals
      .filter((signal) => signal.taskAId === taskId || signal.taskBId === taskId)
      .map((signal) => {
        const detail = signal.evidence.map((entry) => entry.detail).join("; ");
        const view: InspectorStaticSignal = {
          id: signal.id,
          type: signal.type,
          severity: signal.severity,
          detail
        };
        const pairTaskId = signal.taskAId === taskId ? signal.taskBId : signal.taskAId;

        if (pairTaskId !== undefined) {
          view.pairTaskId = pairTaskId;
        }

        return view;
      }),
    traceEvents: snapshot.traceEvents
      .filter((event) => event.taskId === taskId)
      .map((event) => {
        const summary = summarizeTracePayload(event.payload);
        const view: InspectorTraceEvent = {
          id: event.id,
          type: event.type,
          timestamp: event.timestamp,
          actor: event.actor
        };

        if (summary !== undefined) {
          view.summary = summary;
        }

        return view;
      }),
    gateRequired: gateRequiredTasks.has(taskId),
    manual: authoredByForNode(node) === "human",
    integrator: node.metadata?.integrator === true
  };
  const authoredBy = authoredByForNode(node);
  if (authoredBy !== undefined) {
    inspector.authoredBy = authoredBy;
  }

  if (contract !== undefined) {
    inspector.contract = {
      objective: contract.objective,
      definitionOfDone: contract.definitionOfDone,
      acceptanceCriteria: contract.acceptance.map((entry) => entry.description),
      allowedPaths: [...contract.allowed.paths],
      forbiddenPaths: [...contract.forbidden.paths],
      expectedFiles: [...contract.expectedOutput.changedFiles],
      producedSymbols: [...contract.expectedOutput.producedSymbols],
      consumedSymbols: [...contract.expectedOutput.consumedSymbols],
      relevantSymbols: [...contract.relevantSymbols],
      dependencies: [...contract.dependencies],
      knownRisks: [...contract.knownRisks],
      maxDurationMs: contract.limits.maxDurationMs,
      maxCostUsd: contract.limits.maxCostUsd
    };
  }

  if (result !== undefined) {
    inspector.runResult = {
      success: result.success,
      worktree: result.worktree,
      branch: result.branch,
      changedFiles: [...result.changedFiles],
      scopeViolations: [...result.scopeViolations],
      durationMs: result.metrics.durationMs,
      costUsd: result.metrics.costUsd
    };

    if (result.diff !== "") {
      inspector.runResult.diff = result.diff;
    }

    inspector.validation = {
      passed: result.validation.passed,
      checks: result.validation.checks.map((check) => ({
        kind: check.kind,
        passed: check.passed,
        summary: check.summary,
        durationMs: check.durationMs
      }))
    };
  }

  if (blocked !== undefined) {
    inspector.blockedReason = blocked.reason;
  }

  const isComposite = node.kind === "composite" || node.metadata?.integrator === true;
  if (isComposite) {
    const children: InspectorIntegrationChild[] = node.childrenIds.map((childId) => {
      const child = snapshot.graphSnapshot.nodes[childId];
      const childStatus = statusForNode(
        snapshot,
        childId,
        child?.status ?? "planned",
        resultsByTaskId,
        blockedByTaskId
      );
      return {
        taskId: childId,
        title: child?.title ?? childId,
        status: childStatus,
        executed: resultsByTaskId.has(childId)
      };
    });
    // `result` is intentionally omitted: IntegrationResult is produced by the
    // execution core (Etapa 1). Until then the Integration tab shows a pending state.
    inspector.integration = {
      compositeTaskId: taskId,
      children
    };
  }

  return inspector;
}

function collectGateRequiredTasks(snapshot: RunSnapshot): Set<string> {
  const taskIds = new Set<string>();

  for (const event of snapshot.traceEvents) {
    if (
      event.type === "human_gate_required" ||
      event.type === "task_serialized_by_gate" ||
      event.type === "task_blocked_by_gate" ||
      event.type === "human_review_requested"
    ) {
      if (event.taskId !== undefined) {
        taskIds.add(event.taskId);
      }

      const payloadTaskIds = asStringArray(event.payload.taskIds);
      for (const id of payloadTaskIds) {
        taskIds.add(id);
      }
    }
  }

  for (const blocked of snapshot.blockedTasks) {
    if (blocked.requiresHumanReview) {
      taskIds.add(blocked.taskId);
    }
  }

  return taskIds;
}

function highestRiskLevelForTask(snapshot: RunSnapshot, taskId: string): RiskLevel | undefined {
  const levels = snapshot.riskPredictions
    .filter((prediction) => prediction.taskAId === taskId || prediction.taskBId === taskId)
    .map((prediction) => prediction.level);

  return levels.sort((left, right) => riskRank[right] - riskRank[left])[0];
}

function statusForNode(
  snapshot: RunSnapshot,
  taskId: string,
  fallbackStatus: string,
  resultsByTaskId: ReadonlyMap<string, RunSnapshot["agentRunResults"][number]>,
  blockedByTaskId: ReadonlyMap<string, RunSnapshot["blockedTasks"][number]>
): GraphNodeStatus {
  const result = resultsByTaskId.get(taskId);

  if (result !== undefined) {
    return result.success ? "done" : "failed";
  }

  const blocked = blockedByTaskId.get(taskId);

  if (blocked !== undefined) {
    return blocked.requiresHumanReview ? "gated" : "blocked";
  }

  const node = snapshot.graphSnapshot.nodes[taskId];

  if (node?.kind === "composite") {
    const childStatuses = node.childrenIds.map((childId) =>
      statusForNode(
        snapshot,
        childId,
        snapshot.graphSnapshot.nodes[childId]?.status ?? "planned",
        resultsByTaskId,
        blockedByTaskId
      )
    );

    if (childStatuses.length > 0 && childStatuses.every((status) => status === "done")) {
      return "done";
    }

    if (childStatuses.some((status) => status === "failed")) {
      return "failed";
    }

    if (childStatuses.some((status) => status === "gated")) {
      return "gated";
    }

    if (childStatuses.some((status) => status === "blocked")) {
      return "blocked";
    }
  }

  return normalizeStatus(fallbackStatus);
}

function normalizeStatus(status: string): GraphNodeStatus {
  switch (status) {
    case "planned":
    case "ready":
    case "running":
    case "gated":
    case "done":
    case "failed":
    case "blocked":
    case "generating":
    case "needs_review":
    case "approved":
    case "integrated":
      return status;
    case "validating":
      return "running";
    case "executed":
    case "merged":
    case "succeeded":
      return "done";
    case "conflict":
      return "blocked";
    default:
      return "planned";
  }
}

function gateEdgeFromTraceEvent(event: RunSnapshot["traceEvents"][number]): GraphEdgeView | null {
  if (event.type !== "human_gate_decision_recorded") {
    return null;
  }

  const decision = asRecord(event.payload.decision);
  const taskIds = asStringArray(decision?.taskIds);

  if (decision === null || taskIds.length < 2) {
    return null;
  }

  const source = taskIds[0];
  const target = taskIds[1];

  if (source === undefined || target === undefined) {
    return null;
  }

  const kind = typeof decision.kind === "string" ? decision.kind : "gate";
  const riskLevel = typeof decision.riskLevel === "string" ? decision.riskLevel : undefined;
  const id = typeof decision.id === "string" ? decision.id : `${source}:${target}:${kind}`;
  const view: GraphEdgeView = {
    id: `gate:${id}`,
    source,
    target,
    kind: "gate",
    label: kind
  };

  if (isRiskLevel(riskLevel)) {
    view.riskLevel = riskLevel;
  }

  return view;
}

function summarizeTracePayload(payload: Record<string, unknown>): string | undefined {
  if (payload === null || payload === undefined) {
    return undefined;
  }

  const reason = payload.reason;
  if (typeof reason === "string" && reason.length > 0) {
    return reason;
  }

  const recommendation = payload.recommendation;
  if (typeof recommendation === "string" && recommendation.length > 0) {
    return recommendation;
  }

  const decision = asRecord(payload.decision);
  if (decision !== null) {
    const kind = decision.kind;
    if (typeof kind === "string") {
      return `decision: ${kind}`;
    }
  }

  const success = payload.success;
  if (typeof success === "boolean") {
    return success ? "success" : "failed";
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function authoredByForNode(node: RunSnapshot["graphSnapshot"]["nodes"][string]): "ai" | "human" | undefined {
  const value = node.metadata?.authoredBy;
  return value === "ai" || value === "human" ? value : undefined;
}

function isRiskLevel(value: unknown): value is GraphRiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "blocking";
}

function acknowledgedRisk(prediction: RunSnapshot["riskPredictions"][number]): boolean {
  const value = (prediction as { acknowledged?: unknown }).acknowledged;
  return value === true;
}
