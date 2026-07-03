import type { RunExecutionResult } from "@manyhands/execution-core";
import { isExecutionResult } from "@/lib/execution-summary";
import { isProjectablePlanning, isProjectableSnapshot, projectRunRecordToSnapshot } from "@/lib/live-graph";
import type {
  Actor,
  GranularityMetrics,
  NodeId,
  NodeRole,
  PlanningState,
  Run,
  RunControl,
  RunEvent,
  RunEventPayloads,
  RunEventType,
  SeamRevisionRef,
  TestSummary
} from "@/lib/run-model/types";
import type { PlanningLiveNode, RunRecord } from "./schema";
import { executionSelection, planningSelection, repairSelection } from "./executor-selection";

const INTEGRATION_SUCCESS = new Set(["success", "executor_repair_success"]);
const UNAVAILABLE = "unavailable";

interface InterfaceContractLike {
  id: string;
  signature: string;
}

export interface AgentTaskContractLike {
  taskId: string;
  allowed: { paths: string[] };
  executionScope?: {
    implementationPaths?: string[];
    testPaths?: string[];
    configPaths?: string[];
  };
  producedInterfaces?: InterfaceContractLike[];
  consumedInterfaces?: InterfaceContractLike[];
}

interface PlannedNode {
  id: string;
  parentId: string | null;
  kind: "root" | "composite" | "leaf" | "integrator";
  title: string;
  goal: string;
  depth: number;
  contract?: AgentTaskContractLike | undefined;
}

interface EventWriter {
  emit<K extends RunEventType>(actor: Actor, at: string, type: K, payload: RunEventPayloads[K]): void;
  events(): RunEvent[];
}

export function buildRunModelSeed(run: RunRecord): Run {
  const g = String(run.granularity);
  const aggressiveness = g === "coarse" || g === "low" ? "low" : g === "fine" || g === "high" ? "high" : "medium";
  const planning = planningSelection(run);
  const exec = executionSelection(run);
  const repair = repairSelection(run);
  return {
    id: run.runId,
    intent: run.userPrompt || run.title,
    workspaceId: run.workspaceId,
    control: runControlForRun(run),
    config: {
      aggressiveness,
      planningModel: planning.model,
      executionSelection: { executorId: exec.executorId, model: exec.model },
      repairSelection: { executorId: repair.executorId, model: repair.model }
    },
    ...(run.provisioned !== undefined
      ? {
          context: {
            repo: run.provisioned.repoRoot,
            baseCommit: run.provisioned.baseCommit,
            readiness: "ok"
          }
        }
      : {})
  };
}

/**
 * Project the persisted RunRecord into the agent-first event envelope.
 *
 * This closes the G-1 reload gap: the in-memory SSE bus can be empty after a
 * server restart, but the record still has the current plan/execution snapshot.
 * The projection is intentionally state-shaped, not a pretend historical replay.
 */
export function projectRunRecordToRunEvents(run: RunRecord): RunEvent[] {
  const writer = createWriter(run.runId);
  const planningAt = run.decomposition?.generatedAt ?? run.updatedAt;
  const executionAt = run.completedAt ?? run.updatedAt;

  writer.emit("system", run.createdAt, "run.created", {
    intent: run.userPrompt || run.title,
    workspaceId: run.workspaceId,
    config: buildRunModelSeed(run).config
  });
  writer.emit("system", run.updatedAt, "run.status.changed", runControlForRun(run));

  if (run.provisioned !== undefined) {
    writer.emit("system", run.provisioned.provisionedAt, "run.context.resolved", {
      repo: run.provisioned.repoRoot,
      baseCommit: run.provisioned.baseCommit,
      readiness: "ok"
    });
  }

  const snapshot = hasProjectableSnapshotInput(run) ? projectRunRecordToSnapshot(run) : null;
  if (snapshot !== null) {
    writer.emit("system", run.startedAt ?? run.createdAt, "plan.started", {});
    const nodes = (Object.values(snapshot.graphSnapshot.nodes) as PlannedNode[]).sort(byDepthThenId);
    const contracts = snapshot.contracts as AgentTaskContractLike[];
    const contractsByTask = new Map(contracts.map((contract) => [contract.taskId, contract]));

    for (const node of nodes) {
      writer.emit("system", planningAt, "plan.node.proposed", {
        nodeId: node.id,
        parentId: node.parentId,
        role: roleForNode(node),
        title: node.title,
        goal: node.goal,
        depth: node.depth
      });
      const scope = scopePathsFor(contractsByTask.get(node.id) ?? node.contract);
      if (scope.length > 0) {
        writer.emit("system", planningAt, "scope.derived", {
          nodeId: node.id,
          paths: scope
        });
      }
    }

    const seams = seamDraftsFromContracts(contracts);
    for (const seam of seams) {
      writer.emit("system", planningAt, "plan.seam.proposed", seam);
    }

    if (isPlanApproved(run) && seams.length > 0) {
      writer.emit("system", run.approvedAt ?? planningAt, "grounding.started", {});
      for (const seam of seams) {
        writer.emit("system", run.approvedAt ?? planningAt, "seam.frozen", {
          seamId: seam.seamId,
          revision: 1,
          frozenSignature: seam.draftSignature,
          extractedFrom: `contract:${seam.producerNodeId}`
        });
      }
      writer.emit("system", run.approvedAt ?? planningAt, "grounding.completed", {
        skeletonCommit: run.provisioned?.baseCommit ?? run.baseCommit ?? UNAVAILABLE
      });
    }

    writer.emit("system", planningAt, "plan.ready", {
      rootId: snapshot.graphSnapshot.rootId,
      nodeCount: nodes.length,
      seamCount: seams.length,
      criticFindings: criticFindingsFor(run)
    });

    const approvalNodeIds = executableNodeIds(nodes);
    if (needsPlanApprovalDecision(run)) {
      writer.emit("system", planningAt, "decision.raised", {
        decisionId: "approve_plan",
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds: approvalNodeIds }
      });
      if (isPlanApproved(run)) {
        writer.emit("human", run.approvedAt ?? run.updatedAt, "decision.resolved", {
          decisionId: "approve_plan",
          choice: { action: "approve" },
          actor: "human"
        });
      }
    }
  } else if (run.livePlanningNodes !== undefined && run.livePlanningNodes.length > 0) {
    writer.emit("system", run.startedAt ?? run.createdAt, "plan.started", {});
    for (const node of [...run.livePlanningNodes].sort(byLiveDepthThenId)) {
      writer.emit("system", planningAt, "plan.node.proposed", {
        nodeId: node.id,
        parentId: node.parentId,
        role: node.parentId === null ? "root" : "leaf",
        title: node.title,
        goal: node.goal ?? node.title,
        depth: node.depth
      });
      const state = planningStateFor(node.state);
      if (state !== null) {
        writer.emit("system", planningAt, "plan.node.status", {
          nodeId: node.id,
          state,
          ...(node.attempt !== undefined ? { attempt: node.attempt } : {}),
          ...(node.maxAttempts !== undefined ? { maxAttempts: node.maxAttempts } : {}),
          ...(node.durationMs !== undefined ? { durationMs: node.durationMs } : {}),
          ...(node.errorKind !== undefined ? { errorKind: node.errorKind } : {}),
          ...(node.errorMessage !== undefined ? { errorMessage: node.errorMessage } : {})
        });
      }
    }
  }

  if (run.pendingQuestion !== undefined) {
    writer.emit("system", run.updatedAt, "decision.raised", {
      decisionId: `clarify:${run.pendingQuestion.nodeId}`,
      kind: "clarify",
      blocking: true,
      context: {
        nodeIds: [run.pendingQuestion.nodeId],
        question: run.pendingQuestion.question,
        options: [...run.pendingQuestion.options]
      }
    });
  }

  if (isExecutionResult(run.execution)) {
    const exec = executionSelection(run);
    const seamRefsByTask = builtAgainstByTask(run);
    for (const leaf of run.execution.leafResults) {
      writer.emit("agent", executionAt, "node.execution.started", {
        nodeId: leaf.taskId,
        agent: exec.executorId,
        model: exec.model
      });
      if (leaf.status === "success") {
        const produces = producedRevisionFor(run, leaf.taskId);
        writer.emit("agent", executionAt, "node.verify.passed", {
          nodeId: leaf.taskId,
          commit: leaf.commitSha ?? leaf.currentHead,
          changedFiles: [...leaf.changedFiles],
          builtAgainst: seamRefsByTask.get(leaf.taskId) ?? [],
          ...(produces !== undefined ? { produces } : {})
        });
      } else {
        writer.emit("agent", executionAt, "node.execution.failed", {
          nodeId: leaf.taskId,
          cause: leafFailureCause(leaf)
        });
      }
    }

    for (const integration of run.execution.integrationResults) {
      const childNodeIds = integration.childResults.map((child) => child.taskId);
      writer.emit("system", executionAt, "integration.started", {
        compositeNodeId: integration.compositeTaskId,
        childNodeIds
      });
      if (integration.conflictDetails !== undefined) {
        const conflictId = `integration:${integration.compositeTaskId}:conflict`;
        writer.emit("system", executionAt, "conflict.detected", {
          conflictId,
          dimension: "textual",
          status: INTEGRATION_SUCCESS.has(integration.status) ? "resolved" : "detected",
          nodeIds: childNodeIds,
          files: [...integration.conflictDetails.files],
          autoResolvable: integration.repairAttempted,
          diagnosisRef: `diagnosis://runs/${run.runId}/integration/${integration.compositeTaskId}`
        });
        if (INTEGRATION_SUCCESS.has(integration.status)) {
          writer.emit("system", executionAt, "conflict.resolved", {
            conflictId,
            by: "system",
            resolutionId: integration.status
          });
        }
      }
      writer.emit("system", executionAt, "integration.validated", {
        compositeNodeId: integration.compositeTaskId,
        testsPass: integration.parentValidation?.passed === false ? 0 : 1,
        testsTotal: integration.parentValidation !== undefined ? 1 : 0,
        passed: INTEGRATION_SUCCESS.has(integration.status)
      });
      writer.emit("system", executionAt, "integration.completed", {
        compositeNodeId: integration.compositeTaskId,
        commit: integration.integrationCommitSha ?? UNAVAILABLE,
        status: INTEGRATION_SUCCESS.has(integration.status) ? "success" : integration.status
      });
    }

    if (run.execution.status === "completed") {
      writer.emit("system", executionAt, "run.evidence.ready", {
        aggregateDiffRef: `diff://runs/${run.runId}/final`,
        tests: testsFor(run.execution),
        narrativeRef: `narrative://runs/${run.runId}/receipt`,
        integrationCommit: run.finalCommitSha ?? run.integrationCommitSha ?? lastIntegrationCommit(run) ?? UNAVAILABLE
      });
      writer.emit("system", executionAt, "decision.raised", {
        decisionId: "approve_merge",
        kind: "approve_merge",
        blocking: true,
        context: { diffRef: `diff://runs/${run.runId}/final` }
      });
    }

    writer.emit("system", executionAt, "run.metrics.ready", {
      metrics: metricsFromVector(run.execution.granularityVector)
    });
  }

  if (
    run.status === "completed" ||
    run.status === "completed_with_accepted" ||
    run.status === "failed" ||
    run.status === "interrupted"
  ) {
    writer.emit("system", run.completedAt ?? run.updatedAt, "run.completed", {
      status: run.status === "completed" || run.status === "completed_with_accepted" ? "success" : run.status
    });
  }

  return writer.events();
}

function createWriter(runId: string): EventWriter {
  let seq = 0;
  const events: RunEvent[] = [];
  return {
    emit(actor, at, type, payload) {
      seq += 1;
      events.push({
        seq,
        at,
        runId,
        actor,
        type,
        payload: payload as Record<string, unknown>
      });
    },
    events() {
      return events;
    }
  };
}

function hasProjectableSnapshotInput(run: RunRecord): boolean {
  const execution = run.execution;
  if (isRecord(execution) && isProjectableSnapshot(execution.snapshot)) return true;
  return isProjectablePlanning(run.planning);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function roleForNode(node: PlannedNode): NodeRole {
  if (node.kind === "root" || node.parentId === null) return "root";
  if (node.kind === "composite") return "composite";
  return "leaf";
}

function byDepthThenId(left: PlannedNode, right: PlannedNode): number {
  return left.depth - right.depth || left.id.localeCompare(right.id);
}

function byLiveDepthThenId(left: PlanningLiveNode, right: PlanningLiveNode): number {
  return left.depth - right.depth || left.id.localeCompare(right.id);
}

function scopePathsFor(contract: AgentTaskContractLike | undefined): string[] {
  if (contract === undefined) return [];
  const executionScope = contract.executionScope;
  const paths = [
    ...(executionScope?.implementationPaths ?? []),
    ...(executionScope?.testPaths ?? []),
    ...(executionScope?.configPaths ?? [])
  ];
  return paths.length > 0 ? unique(paths) : unique(contract.allowed.paths);
}

type SeamDraft = RunEventPayloads["plan.seam.proposed"];

export function seamDraftsFromContracts(contracts: readonly AgentTaskContractLike[]): SeamDraft[] {
  const produced = new Map<string, { iface: InterfaceContractLike; producerNodeId: string }>();
  const consumers = new Map<string, string[]>();

  for (const contract of contracts) {
    for (const iface of contract.producedInterfaces ?? []) {
      if (!produced.has(iface.id)) {
        produced.set(iface.id, { iface, producerNodeId: contract.taskId });
      }
    }
    for (const iface of contract.consumedInterfaces ?? []) {
      const list = consumers.get(iface.id) ?? [];
      list.push(contract.taskId);
      consumers.set(iface.id, list);
    }
  }

  return [...produced.values()]
    .sort((left, right) => left.iface.id.localeCompare(right.iface.id))
    .map(({ iface, producerNodeId }) => ({
      seamId: iface.id,
      name: iface.id,
      producerNodeId,
      consumerNodeIds: unique(consumers.get(iface.id) ?? []),
      draftSignature: iface.signature
    }));
}

function criticFindingsFor(run: RunRecord): string[] {
  return [
    ...(run.planningCritic?.findings ?? []).map((finding) => finding.message),
    ...(run.seamCritic?.findings ?? []).map((finding) => finding.message)
  ];
}

function executableNodeIds(nodes: readonly PlannedNode[]): NodeId[] {
  return nodes.filter((node) => node.kind === "leaf" || node.kind === "integrator").map((node) => node.id);
}

function needsPlanApprovalDecision(run: RunRecord): boolean {
  return run.planning !== undefined && run.status !== "created" && run.status !== "generating";
}

function isPlanApproved(run: RunRecord): boolean {
  return (
    run.approvedAt !== undefined ||
    run.status === "approved" ||
    run.status === "running" ||
    run.status === "completed" ||
    run.status === "completed_with_accepted" ||
    (run.status === "failed" && run.failedDuring === "running")
  );
}

function planningStateFor(state: PlanningLiveNode["state"]): PlanningState | null {
  switch (state) {
    case "complete":
    case "generated":
      return "generated";
    case "generating":
      return "generating";
    case "retrying":
      return "retrying";
    case "failed":
      return "failed";
    case "fallback":
      return "fallback";
    default:
      return null;
  }
}

function builtAgainstByTask(run: RunRecord): Map<string, SeamRevisionRef[]> {
  const snapshot = projectRunRecordToSnapshot(run);
  const out = new Map<string, SeamRevisionRef[]>();
  const revision = revisionForRun(run);
  for (const contract of (snapshot?.contracts ?? []) as AgentTaskContractLike[]) {
    const refs = (contract.consumedInterfaces ?? []).map((iface) => ({ seamId: iface.id, revision }));
    if (refs.length > 0) out.set(contract.taskId, refs);
  }
  return out;
}

function producedRevisionFor(run: RunRecord, taskId: string): SeamRevisionRef | undefined {
  const snapshot = projectRunRecordToSnapshot(run);
  const contract = ((snapshot?.contracts ?? []) as AgentTaskContractLike[]).find((entry) => entry.taskId === taskId);
  const first = contract?.producedInterfaces?.[0];
  return first !== undefined ? { seamId: first.id, revision: revisionForRun(run) } : undefined;
}

function revisionForRun(run: RunRecord): number {
  return isPlanApproved(run) ? 1 : 0;
}

export function runControlForRun(run: RunRecord): RunControl {
  return {
    status: run.status,
    version: run.version,
    pendingHumanAction:
      run.pendingDecision !== undefined
        ? "decision"
        : run.pendingQuestion !== undefined || run.pendingReplan !== undefined
          ? "question"
          : "none",
    updatedAt: run.updatedAt,
    ...(run.pausedDuring !== undefined ? { pausedDuring: run.pausedDuring } : {}),
    ...(run.interruptedDuring !== undefined ? { interruptedDuring: run.interruptedDuring } : {})
  };
}

function leafFailureCause(leaf: { status: string; executorExitCode: number; executorTimedOut: boolean; stderrTail?: string | undefined }): string {
  if (leaf.executorTimedOut) return `${leaf.status}: timed out`;
  const stderr = leaf.stderrTail?.trim();
  if (stderr !== undefined && stderr.length > 0) return `${leaf.status}: ${stderr}`;
  return `${leaf.status}: executor exit ${leaf.executorExitCode}`;
}

function testsFor(execution: RunExecutionResult): TestSummary {
  if (execution.validationResult !== undefined) {
    return { pass: execution.validationResult.passed ? 1 : 0, total: 1 };
  }
  const checks = execution.leafResults
    .map((leaf) => leaf.validationResult)
    .filter((result): result is NonNullable<RunExecutionResult["leafResults"][number]["validationResult"]> => result !== undefined);
  return { pass: checks.filter((result) => result.passed).length, total: checks.length };
}

function lastIntegrationCommit(run: RunRecord): string | undefined {
  if (!isExecutionResult(run.execution)) return undefined;
  for (const integration of [...run.execution.integrationResults].reverse()) {
    if (integration.integrationCommitSha !== undefined) return integration.integrationCommitSha;
  }
  return undefined;
}

function metricsFromVector(vector: RunExecutionResult["granularityVector"]): GranularityMetrics {
  return {
    depth: vector.depth,
    leafCount: vector.leafCount,
    compositeCount: vector.compositeCount,
    avgLeafDepth: vector.avgLeafDepth,
    maxLeafDepth: vector.maxLeafDepth,
    dependencyCount: vector.dependencyCount,
    avgAcceptanceCriteriaPerLeaf: vector.avgAcceptanceCriteriaPerLeaf,
    ...(vector.estimatedTokensPerLeaf !== undefined ? { estimatedTokensPerLeaf: vector.estimatedTokensPerLeaf } : {}),
    integrationSuccessRate: vector.integrationSuccessRate,
    leafSuccessRate: vector.leafSuccessRate,
    conflictRate: vector.conflictRate,
    totalDurationMs: vector.totalDurationMs,
    linesChanged: vector.linesChanged,
    unexpectedCommitCount: vector.unexpectedCommitCount,
    scopeViolationCount: vector.scopeViolationCount,
    ...(vector.totalCostUsd !== undefined ? { totalCostUsd: vector.totalCostUsd } : {}),
    ...(vector.testsPassedRate !== undefined ? { testsPassedRate: vector.testsPassedRate } : {})
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
