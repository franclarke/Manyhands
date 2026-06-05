import {
  findRiskPrediction,
  type ConflictPrediction,
  type TaskPairRiskMatrix
} from "@manyhands/conflict-risk";
import type { AgentTaskContract } from "@manyhands/contracts";
import {
  getTopologicalOrder,
  type TaskDependency,
  type TaskGraph,
  type TaskNodeStatus
} from "@manyhands/task-graph";
import { z } from "zod";

export const SchedulingPolicySchema = z.union([
  z.literal("sequential_dag"),
  z.literal("parallel_naive"),
  z.literal("risk_aware")
]);

export type SchedulingPolicy = z.infer<typeof SchedulingPolicySchema>;

export interface SchedulerInput {
  graph: TaskGraph;
  contracts: Record<string, AgentTaskContract>;
  riskMatrix: TaskPairRiskMatrix;
  maxParallel: number;
  policy: SchedulingPolicy;
}

export interface SchedulerBatchDecision {
  taskId: string;
  reason: string;
}

export const SchedulerBatchDecisionSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1)
});

export interface ExecutionBatch {
  id: string;
  taskIds: string[];
  rationale: string;
  decisions: SchedulerBatchDecision[];
}

export const ExecutionBatchSchema = z.object({
  id: z.string().min(1),
  taskIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
  decisions: z.array(SchedulerBatchDecisionSchema)
});

export interface BlockedTask {
  taskId: string;
  reason: string;
  requiresHumanReview: boolean;
}

export const BlockedTaskSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1),
  requiresHumanReview: z.boolean()
});

export interface SchedulerPlan {
  policy: SchedulingPolicy;
  batches: ExecutionBatch[];
  blocked: BlockedTask[];
  explanations: string[];
}

export const SchedulerPlanSchema = z.object({
  policy: SchedulingPolicySchema,
  batches: z.array(ExecutionBatchSchema),
  blocked: z.array(BlockedTaskSchema),
  explanations: z.array(z.string().min(1))
});

export const HumanGateDecisionKindSchema = z.union([
  z.literal("approved_parallel"),
  z.literal("serialized"),
  z.literal("serialized_after_mock_review"),
  z.literal("blocked"),
  z.literal("requires_manual_review")
]);

export type HumanGateDecisionKind = z.infer<typeof HumanGateDecisionKindSchema>;

export interface HumanGateDecision {
  id: string;
  kind: HumanGateDecisionKind;
  taskIds: string[];
  riskLevel: ConflictPrediction["level"];
  reason: string;
}

export const HumanGateDecisionSchema = z.object({
  id: z.string().min(1),
  kind: HumanGateDecisionKindSchema,
  taskIds: z.array(z.string().min(1)).min(1),
  riskLevel: z.union([
    z.literal("low"),
    z.literal("medium"),
    z.literal("high"),
    z.literal("blocking")
  ]),
  reason: z.string().min(1)
});

export interface HumanGateMetrics {
  gateRequiredCount: number;
  approvedParallelCount: number;
  serializedByGateCount: number;
  blockedByGateCount: number;
  mockReviewCount: number;
}

export const HumanGateMetricsSchema = z.object({
  gateRequiredCount: z.number().int().nonnegative(),
  approvedParallelCount: z.number().int().nonnegative(),
  serializedByGateCount: z.number().int().nonnegative(),
  blockedByGateCount: z.number().int().nonnegative(),
  mockReviewCount: z.number().int().nonnegative()
});

export interface HumanGateResult {
  plan: SchedulerPlan;
  decisions: HumanGateDecision[];
  metrics: HumanGateMetrics;
  explanations: string[];
}

export const HumanGateResultSchema = z.object({
  plan: SchedulerPlanSchema,
  decisions: z.array(HumanGateDecisionSchema),
  metrics: HumanGateMetricsSchema,
  explanations: z.array(z.string().min(1))
});

const resolvedStatuses = new Set<TaskNodeStatus>(["done", "merged"]);
const blockedStatuses = new Set<TaskNodeStatus>(["failed", "conflict", "running", "validating"]);

export function scheduleTasks(input: SchedulerInput): SchedulerPlan {
  const maxParallel = Math.max(1, input.maxParallel);
  const leafIds = orderedExecutableTaskIds(input.graph);
  const resolved = new Set(
    leafIds.filter((taskId) => resolvedStatuses.has(input.graph.nodes[taskId]?.status ?? "planned"))
  );
  const unscheduled = new Set(
    leafIds.filter((taskId) => !resolved.has(taskId) && !blockedStatuses.has(input.graph.nodes[taskId]?.status ?? "planned"))
  );
  const blocked: BlockedTask[] = leafIds
    .filter((taskId) => blockedStatuses.has(input.graph.nodes[taskId]?.status ?? "planned"))
    .map((taskId) => ({
      taskId,
      reason: `task status is ${input.graph.nodes[taskId]?.status ?? "unknown"}`,
      requiresHumanReview: input.graph.nodes[taskId]?.status === "conflict"
    }));
  const batches: ExecutionBatch[] = [];
  const explanations: string[] = [];
  const humanReviewTaskIds =
    input.policy === "risk_aware"
      ? tasksRequiringHumanReview(input.riskMatrix, unscheduled)
      : new Set<string>();

  for (const taskId of humanReviewTaskIds) {
    if (unscheduled.delete(taskId)) {
      blocked.push({
        taskId,
        reason: "blocking conflict risk requires human review",
        requiresHumanReview: true
      });
    }
  }

  while (unscheduled.size > 0) {
    const ready = leafIds.filter(
      (taskId) => unscheduled.has(taskId) && dependenciesResolved(input.graph.dependencies, taskId, resolved)
    );

    if (ready.length === 0) {
      for (const taskId of unscheduled) {
        blocked.push({
          taskId,
          reason: unmetDependencyReason(input.graph.dependencies, taskId, resolved),
          requiresHumanReview: false
        });
      }

      break;
    }

    const selected =
      input.policy === "risk_aware"
        ? selectRiskAwareBatch(ready, input.riskMatrix, maxParallel)
        : selectSimpleBatch(ready, input.policy, maxParallel);

    if (selected.length === 0) {
      for (const taskId of ready) {
        blocked.push({
          taskId,
          reason: "no schedulable task could be selected",
          requiresHumanReview: false
        });
        unscheduled.delete(taskId);
      }

      continue;
    }

    const batchId = `batch-${batches.length + 1}`;
    const decisions = selected.map((taskId) => ({
      taskId,
      reason: decisionReason(input.policy, taskId, selected, input.riskMatrix)
    }));
    const rationale = rationaleForBatch(input.policy, selected);

    batches.push({
      id: batchId,
      taskIds: selected,
      rationale,
      decisions
    });
    explanations.push(`${batchId}: ${rationale}`);

    for (const taskId of selected) {
      unscheduled.delete(taskId);
      resolved.add(taskId);
    }
  }

  return {
    policy: input.policy,
    batches,
    blocked,
    explanations
  };
}

export function applyHumanGateToSchedule(input: {
  plan: SchedulerPlan;
  riskMatrix: TaskPairRiskMatrix;
}): HumanGateResult {
  const parsedPlan = SchedulerPlanSchema.parse(input.plan);
  const highPredictions = input.riskMatrix.filter((prediction) => prediction.level === "high");
  const blockingPredictions = input.riskMatrix.filter((prediction) => prediction.level === "blocking");
  const decisions: HumanGateDecision[] = [];
  const explanations: string[] = [];
  const reviewApprovedTaskIds = new Set<string>();

  for (const prediction of highPredictions) {
    decisions.push(decisionForPrediction(
      "serialized",
      prediction,
      "high conflict risk is serialized by deterministic human gate policy"
    ));
  }

  for (const prediction of blockingPredictions) {
    decisions.push(decisionForPrediction(
      "requires_manual_review",
      prediction,
      "blocking conflict risk requires simulated human review"
    ));
    decisions.push(decisionForPrediction(
      "serialized_after_mock_review",
      prediction,
      "mock review approves execution only as serialized singleton tasks"
    ));
    reviewApprovedTaskIds.add(prediction.taskAId);
    reviewApprovedTaskIds.add(prediction.taskBId);
  }

  const scheduledTaskIds = new Set(parsedPlan.batches.flatMap((batch) => batch.taskIds));
  const carriedBlocked: BlockedTask[] = [];
  const appendedBatches: ExecutionBatch[] = [];

  for (const blocked of parsedPlan.blocked) {
    if (!reviewApprovedTaskIds.has(blocked.taskId)) {
      carriedBlocked.push(blocked);
      continue;
    }

    if (!scheduledTaskIds.has(blocked.taskId)) {
      const batchId = `gate-batch-${appendedBatches.length + 1}`;
      appendedBatches.push({
        id: batchId,
        taskIds: [blocked.taskId],
        rationale: `human gate mock review serialized ${blocked.taskId}`,
        decisions: [{
          taskId: blocked.taskId,
          reason: "selected after deterministic mock human review"
        }]
      });
      scheduledTaskIds.add(blocked.taskId);
      explanations.push(`${batchId}: ${blocked.taskId} serialized after mock review`);
    }
  }

  const nextPlan: SchedulerPlan = {
    ...parsedPlan,
    batches: [
      ...parsedPlan.batches,
      ...appendedBatches
    ],
    blocked: carriedBlocked,
    explanations: [
      ...parsedPlan.explanations,
      ...explanations
    ]
  };
  const metrics: HumanGateMetrics = {
    gateRequiredCount: highPredictions.length + blockingPredictions.length,
    approvedParallelCount: decisions.filter((decision) => decision.kind === "approved_parallel").length,
    serializedByGateCount: decisions.filter((decision) =>
      decision.kind === "serialized" || decision.kind === "serialized_after_mock_review"
    ).length,
    blockedByGateCount: decisions.filter((decision) => decision.kind === "blocked").length,
    mockReviewCount: decisions.filter((decision) => decision.kind === "requires_manual_review").length
  };

  return HumanGateResultSchema.parse({
    plan: nextPlan,
    decisions,
    metrics,
    explanations
  });
}

function orderedExecutableTaskIds(graph: TaskGraph): string[] {
  return getTopologicalOrder(graph).filter((taskId) => {
    const kind = graph.nodes[taskId]?.kind;
    return kind === "leaf" || kind === "integrator";
  });
}

function decisionForPrediction(
  kind: HumanGateDecisionKind,
  prediction: ConflictPrediction,
  reason: string
): HumanGateDecision {
  return HumanGateDecisionSchema.parse({
    id: `gate:${kind}:${prediction.taskAId}:${prediction.taskBId}`,
    kind,
    taskIds: [prediction.taskAId, prediction.taskBId],
    riskLevel: prediction.level,
    reason
  });
}

function dependenciesResolved(
  dependencies: readonly TaskDependency[],
  taskId: string,
  resolved: ReadonlySet<string>
): boolean {
  return dependencies
    .filter((dependency) => dependency.toTaskId === taskId)
    .every((dependency) => resolved.has(dependency.fromTaskId));
}

function unmetDependencyReason(
  dependencies: readonly TaskDependency[],
  taskId: string,
  resolved: ReadonlySet<string>
): string {
  const unmet = dependencies
    .filter((dependency) => dependency.toTaskId === taskId)
    .filter((dependency) => !resolved.has(dependency.fromTaskId))
    .map((dependency) => dependency.fromTaskId);

  return unmet.length > 0
    ? `unmet dependencies: ${unmet.join(", ")}`
    : "task is not ready";
}

function selectSimpleBatch(
  ready: readonly string[],
  policy: SchedulingPolicy,
  maxParallel: number
): string[] {
  if (policy === "sequential_dag") {
    return ready.slice(0, 1);
  }

  return ready.slice(0, maxParallel);
}

function selectRiskAwareBatch(
  ready: readonly string[],
  riskMatrix: TaskPairRiskMatrix,
  maxParallel: number
): string[] {
  const selected: string[] = [];

  for (const taskId of ready) {
    if (selected.length >= maxParallel) {
      break;
    }

    const canJoin = selected.every((selectedTaskId) => {
      const risk = findRiskPrediction(riskMatrix, taskId, selectedTaskId);
      return risk?.level !== "high" && risk?.level !== "blocking";
    });

    if (canJoin) {
      selected.push(taskId);
    }
  }

  return selected;
}

function tasksRequiringHumanReview(
  riskMatrix: TaskPairRiskMatrix,
  candidateTaskIds: ReadonlySet<string>
): Set<string> {
  const blocked = new Set<string>();

  for (const prediction of riskMatrix) {
    if (
      prediction.level === "blocking" &&
      candidateTaskIds.has(prediction.taskAId) &&
      candidateTaskIds.has(prediction.taskBId)
    ) {
      blocked.add(prediction.taskAId);
      blocked.add(prediction.taskBId);
    }
  }

  return blocked;
}

function decisionReason(
  policy: SchedulingPolicy,
  taskId: string,
  batchTaskIds: readonly string[],
  riskMatrix: TaskPairRiskMatrix
): string {
  if (policy === "sequential_dag") {
    return "selected as the next ready task in topological order";
  }

  if (policy === "parallel_naive") {
    return "selected because dependencies are resolved; risk is ignored by this policy";
  }

  const pairRisks = batchTaskIds
    .filter((otherTaskId) => otherTaskId !== taskId)
    .map((otherTaskId) => findRiskPrediction(riskMatrix, taskId, otherTaskId))
    .filter((risk): risk is ConflictPrediction => risk !== undefined);
  const highest = highestRiskLevel(pairRisks);

  return `selected with no high or blocking pair risk in batch; highest pair risk is ${highest}`;
}

function rationaleForBatch(policy: SchedulingPolicy, taskIds: readonly string[]): string {
  if (policy === "sequential_dag") {
    return `sequential DAG policy emits one ready task: ${taskIds.join(", ")}`;
  }

  if (policy === "parallel_naive") {
    return `parallel naive policy groups ready tasks up to max parallelism: ${taskIds.join(", ")}`;
  }

  return `risk aware policy groups ready tasks without high or blocking pair risk: ${taskIds.join(", ")}`;
}

function highestRiskLevel(predictions: readonly ConflictPrediction[]): string {
  const rank = new Map([
    ["low", 0],
    ["medium", 1],
    ["high", 2],
    ["blocking", 3]
  ]);

  let best = "low";

  for (const prediction of predictions) {
    if ((rank.get(prediction.level) ?? 0) > (rank.get(best) ?? 0)) {
      best = prediction.level;
    }
  }

  return best;
}
