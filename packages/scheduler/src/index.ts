import {
  buildStaticConflictSignals,
  buildTaskPairRiskMatrix,
  findRiskPrediction,
  type ConflictPrediction,
  type ConflictEvidenceSignal,
  type ConflictRiskLevel,
  type BuildStaticConflictSignalsInput,
  type StaticConflictSignal,
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

export * from "./types-v2.js";
export * from "./readiness-v2.js";
export * from "./wave-selector-v2.js";

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
  repositoryIndex?: BuildStaticConflictSignalsInput["repositoryIndex"];
  staticSignals?: readonly StaticConflictSignal[];
  maxParallel: number;
  policy: SchedulingPolicy;
}

export type SchedulingWarningCode =
  | "missing_contract"
  | "empty_scope"
  | "missing_repository_index"
  | "risk_matrix_missing"
  | "risk_matrix_incomplete"
  | "parallel_naive_explicit";

export interface SchedulingWarning {
  code: SchedulingWarningCode;
  taskIds: string[];
  message: string;
}

export interface SchedulingSafetyContext {
  contracts: Record<string, AgentTaskContract>;
  riskMatrix: TaskPairRiskMatrix;
  warnings: SchedulingWarning[];
}

export interface SchedulingRiskSummary {
  low: number;
  medium: number;
  high: number;
  blocking: number;
}

export interface SchedulingSafetyContextInput {
  graph: TaskGraph;
  taskIds?: readonly string[];
  contracts?: Record<string, AgentTaskContract>;
  riskMatrix?: TaskPairRiskMatrix;
  repositoryIndex?: BuildStaticConflictSignalsInput["repositoryIndex"];
  staticSignals?: readonly StaticConflictSignal[];
  policy?: SchedulingPolicy;
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

// ── Scope-aware wave selection (adaptive wavefront) ──────────────
//
// Given the dynamic execution frontier (tasks whose dependencies are already
// satisfied), pick the subset that is safe to run concurrently:
//  - pairs predicted as high/blocking conflict risk are never co-scheduled;
//  - tasks whose declared file scopes (executionScope globs) overlap are
//    serialized so parallel agents don't collide on the same files;
//  - tasks without a declared scope carry no scope constraint (free
//    parallelism, D9) but still honour the risk matrix.

export interface ScopeAwareWaveInput {
  graph: TaskGraph;
  /** Frontier candidates, dependency-ready, in stable priority order. */
  candidates: readonly string[];
  riskMatrix?: TaskPairRiskMatrix;
  repositoryIndex?: BuildStaticConflictSignalsInput["repositoryIndex"];
  staticSignals?: readonly StaticConflictSignal[];
  /** Optional hard cap on wave width; omitted = unbounded (D9). */
  maxParallel?: number;
}

export function selectScopeAwareWave(input: ScopeAwareWaveInput): string[] {
  const cap = input.maxParallel !== undefined ? Math.max(1, input.maxParallel) : Number.POSITIVE_INFINITY;
  const riskMatrix = buildSchedulingSafetyContext({
    graph: input.graph,
    taskIds: input.candidates,
    policy: "risk_aware",
    ...(input.riskMatrix !== undefined ? { riskMatrix: input.riskMatrix } : {}),
    ...(input.repositoryIndex !== undefined ? { repositoryIndex: input.repositoryIndex } : {}),
    ...(input.staticSignals !== undefined ? { staticSignals: input.staticSignals } : {})
  }).riskMatrix;
  const scopes = new Map<string, string[][]>(
    input.candidates.map((taskId) => [taskId, scopeSignature(input.graph, taskId)])
  );
  const overlapScopes = withoutCoordinationFiles(scopes);

  const selected: string[] = [];
  for (const taskId of input.candidates) {
    if (selected.length >= cap) break;
    const compatible = selected.every(
      (other) =>
        !isHighRiskPair(riskMatrix, taskId, other) &&
        !scopesOverlap(overlapScopes.get(taskId) ?? [], overlapScopes.get(other) ?? [])
    );
    if (compatible) {
      selected.push(taskId);
    }
  }

  // The frontier is never starved: the first candidate always forms a wave.
  return selected.length > 0 ? selected : input.candidates.slice(0, 1);
}

/**
 * Segment lists for every path pattern the task declared as its write scope.
 *
 * `configPaths` are deliberately excluded: shared manifests (package.json,
 * tsconfig.json, vite/vitest.config.ts) are touched by nearly every task, yet
 * all leaves branch from the same skeleton commit — so serializing on them
 * never avoids the integration-time conflict, it only collapses every wave to a
 * single task. The composer reconciles those files at integration; the wave
 * selector should gate parallelism only on real implementation/test overlap.
 */
function scopeSignature(graph: TaskGraph, taskId: string): string[][] {
  return schedulingScopePatterns(graph, taskId).map(literalSegments);
}

/**
 * Complete literal path segments before the first glob construct. A glob char
 * mid-segment drops that partial segment (conservative: "src/auth*" → ["src"]),
 * so overlap detection errs toward serialization, never toward collisions.
 */
function literalSegments(pattern: string): string[] {
  const segments: string[] = [];
  for (const segment of pattern.replace(/\\/g, "/").split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (/[*?[{]/.test(segment)) break;
    segments.push(segment);
  }
  return segments;
}

function scopesOverlap(a: string[][], b: string[][]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  return a.some((left) => b.some((right) => onePrefixesOther(left, right)));
}

function onePrefixesOther(left: string[], right: string[]): boolean {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.every((segment, index) => segment === longer[index]);
}

/**
 * A path declared by this many candidates (or more) is treated as a shared
 * coordination file rather than a real overlap.
 */
const COORDINATION_SHARE_THRESHOLD = 3;

/**
 * Drop shared *coordination files* from the overlap signatures (O-7). A specific
 * file (one with an extension) that many candidates declare — a barrel, a
 * registry, a shared `index.ts` — is the same class as the `configPaths` that
 * `scopeSignature` already excludes: every leaf branches from the same skeleton
 * commit, so serializing on it never avoids the integration-time conflict (the
 * composer reconciles it), it only collapses the wave to one task at a time.
 * Directory prefixes (from broad globs like `src/**` → `["src"]`) are kept —
 * those are genuine wide overlaps, not coordination files.
 */
function withoutCoordinationFiles(scopes: Map<string, string[][]>): Map<string, string[][]> {
  const counts = new Map<string, number>();
  for (const signature of scopes.values()) {
    for (const segments of signature) {
      if (!isSpecificFile(segments)) continue;
      const key = segments.join("/");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return new Map(
    [...scopes].map(([taskId, signature]) => [
      taskId,
      signature.filter(
        (segments) =>
          !(isSpecificFile(segments) && (counts.get(segments.join("/")) ?? 0) >= COORDINATION_SHARE_THRESHOLD)
      )
    ])
  );
}

/** A literal path whose final segment carries a file extension (e.g. index.ts). */
function isSpecificFile(segments: string[]): boolean {
  const last = segments[segments.length - 1];
  return last !== undefined && /\.[A-Za-z0-9]+$/.test(last);
}

function isHighRiskPair(riskMatrix: TaskPairRiskMatrix, a: string, b: string): boolean {
  const risk = findRiskPrediction(riskMatrix, a, b);
  return risk?.level === "high" || risk?.level === "blocking";
}

export function buildSchedulingSafetyContext(input: SchedulingSafetyContextInput): SchedulingSafetyContext {
  const taskIds = input.taskIds ?? orderedExecutableTaskIds(input.graph);
  const contracts =
    input.contracts !== undefined && Object.keys(input.contracts).length > 0
      ? input.contracts
      : contractsFromGraph(input.graph, taskIds);
  const warnings: SchedulingWarning[] = [];
  const providedRiskMatrix = input.riskMatrix ?? [];
  const staticSignals =
    input.staticSignals ??
    (input.repositoryIndex !== undefined
      ? buildStaticConflictSignals({ contracts, repositoryIndex: input.repositoryIndex })
      : []);
  const generatedRiskMatrix = buildTaskPairRiskMatrix({ contracts, staticSignals });

  if (input.policy === "parallel_naive") {
    warnings.push({
      code: "parallel_naive_explicit",
      taskIds: [...taskIds],
      message: "parallel_naive was explicitly selected; scheduler will ignore risk and scope signals."
    });
  }

  if (input.policy !== "parallel_naive" && providedRiskMatrix.length === 0 && generatedRiskMatrix.length > 0) {
    warnings.push({
      code: "risk_matrix_missing",
      taskIds: [...taskIds],
      message: "risk_aware scheduling generated a risk matrix from task contracts because none was provided."
    });
  }

  if (input.policy !== "parallel_naive" && input.repositoryIndex === undefined && input.staticSignals === undefined) {
    warnings.push({
      code: "missing_repository_index",
      taskIds: [...taskIds],
      message: "repository index was unavailable; risk_aware scheduling used contract/scope heuristics only."
    });
  }

  const riskMatrix = mergeRiskMatrices(providedRiskMatrix, generatedRiskMatrix);
  const incompleteTasks = new Set<string>();
  for (const taskId of taskIds) {
    const node = input.graph.nodes[taskId];
    if (node === undefined) continue;
    if (node.contract === undefined) {
      incompleteTasks.add(taskId);
      warnings.push({
        code: "missing_contract",
        taskIds: [taskId],
        message: `task ${taskId} has no AgentTaskContract; risk_aware scheduling will serialize it conservatively.`
      });
      continue;
    }
    if (!hasSchedulingScope(input.graph, taskId)) {
      incompleteTasks.add(taskId);
      warnings.push({
        code: "empty_scope",
        taskIds: [taskId],
        message: `task ${taskId} has no implementation/test/allowed/expected file scope; risk_aware scheduling will serialize it conservatively.`
      });
    }
  }

  // Coordination files (a barrel / shared index touched by many tasks) must not
  // generate a high-risk pair (O-7) — same rationale as the wave selector: every
  // leaf branches from the same skeleton, so the overlap is reconciled at
  // integration, not avoided by serializing.
  const overlapScopes = withoutCoordinationFiles(
    new Map(taskIds.map((id) => [id, scopeSignature(input.graph, id)]))
  );

  forEachPair(taskIds, (left, right) => {
    if (
      input.policy !== "parallel_naive" &&
      providedRiskMatrix.length > 0 &&
      findRiskPrediction(providedRiskMatrix, left, right) === undefined
    ) {
      warnings.push({
        code: "risk_matrix_incomplete",
        taskIds: [left, right],
        message: `risk matrix did not include ${left}<->${right}; scheduler filled it from contracts/scopes.`
      });
    }

    const scopeOverlap = scopesOverlap(overlapScopes.get(left) ?? [], overlapScopes.get(right) ?? []);
    if (scopeOverlap) {
      upsertConservativeRisk(riskMatrix, conservativePrediction(left, right, "high", {
        signal: "path_overlap",
        detail: `declared execution scopes overlap for ${left} and ${right}`
      }));
    }

    if (incompleteTasks.has(left) || incompleteTasks.has(right)) {
      upsertConservativeRisk(riskMatrix, conservativePrediction(left, right, "high", {
        signal: "path_overlap",
        detail: `missing contract or usable scope prevents proving ${left} and ${right} are independent`
      }));
    }

    const producerConsumer = producerConsumerDetail(contracts[left], contracts[right]);
    if (producerConsumer !== undefined) {
      upsertConservativeRisk(riskMatrix, conservativePrediction(left, right, "high", {
        signal: "producer_consumer",
        detail: producerConsumer
      }));
    }
  });

  return { contracts, riskMatrix, warnings };
}

export function summarizeRiskMatrix(riskMatrix: TaskPairRiskMatrix): SchedulingRiskSummary {
  const summary: SchedulingRiskSummary = {
    low: 0,
    medium: 0,
    high: 0,
    blocking: 0
  };

  for (const prediction of riskMatrix) {
    summary[prediction.level] += 1;
  }

  return summary;
}

export function scheduleTasks(input: SchedulerInput): SchedulerPlan {
  const safety =
    input.policy === "risk_aware"
      ? buildSchedulingSafetyContext({
          graph: input.graph,
          contracts: input.contracts,
          riskMatrix: input.riskMatrix,
          ...(input.repositoryIndex !== undefined ? { repositoryIndex: input.repositoryIndex } : {}),
          ...(input.staticSignals !== undefined ? { staticSignals: input.staticSignals } : {}),
          policy: input.policy
        })
      : undefined;
  const riskMatrix = safety?.riskMatrix ?? input.riskMatrix;
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
      ? tasksRequiringHumanReview(riskMatrix, unscheduled)
      : new Set<string>();

  if (input.policy === "parallel_naive") {
    explanations.push("parallel_naive policy was explicitly selected; conflict risk and scopes are ignored.");
  }
  if (safety !== undefined) {
    explanations.push(...safety.warnings.map((warning) => warning.message));
  }

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
        ? selectRiskAwareBatch(ready, riskMatrix, maxParallel)
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
      reason: decisionReason(input.policy, taskId, selected, riskMatrix)
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

function contractsFromGraph(graph: TaskGraph, taskIds: readonly string[]): Record<string, AgentTaskContract> {
  const contracts: Record<string, AgentTaskContract> = {};
  for (const taskId of taskIds) {
    const contract = graph.nodes[taskId]?.contract;
    if (contract !== undefined) {
      contracts[taskId] = { ...contract, taskId };
    }
  }
  return contracts;
}

function hasSchedulingScope(graph: TaskGraph, taskId: string): boolean {
  return schedulingScopePatterns(graph, taskId).length > 0;
}

function schedulingScopePatterns(graph: TaskGraph, taskId: string): string[] {
  const contract = graph.nodes[taskId]?.contract;
  if (contract === undefined) return [];
  const executionScope = contract.executionScope;
  const executionPaths =
    executionScope !== undefined
      ? [...executionScope.implementationPaths, ...executionScope.testPaths]
      : [];
  const fallbackPaths = [...contract.allowed.paths, ...contract.expectedOutput.changedFiles];
  return uniqueStrings(executionPaths.length > 0 ? executionPaths : fallbackPaths);
}

function mergeRiskMatrices(left: TaskPairRiskMatrix, right: TaskPairRiskMatrix): TaskPairRiskMatrix {
  const merged: TaskPairRiskMatrix = [];
  for (const prediction of [...left, ...right]) {
    upsertConservativeRisk(merged, prediction);
  }
  return merged;
}

function upsertConservativeRisk(matrix: TaskPairRiskMatrix, prediction: ConflictPrediction): void {
  const existingIndex = matrix.findIndex((item) => samePair(item, prediction.taskAId, prediction.taskBId));
  if (existingIndex === -1) {
    matrix.push(prediction);
    return;
  }
  const existing = matrix[existingIndex];
  if (existing === undefined || riskRank(prediction.level) > riskRank(existing.level)) {
    matrix[existingIndex] = prediction;
  }
}

function conservativePrediction(
  taskAId: string,
  taskBId: string,
  level: Extract<ConflictRiskLevel, "high" | "blocking">,
  evidence: { signal: ConflictEvidenceSignal; detail: string }
): ConflictPrediction {
  return {
    taskAId,
    taskBId,
    level,
    score: level === "blocking" ? 1 : 0.8,
    evidence: [{ signal: evidence.signal, detail: evidence.detail, weight: level === "blocking" ? 1 : 0.8 }],
    sharedFiles: [],
    sharedSymbols: [],
    predictedConflictTypes: [evidence.signal],
    recommendation: level === "blocking" ? "requires_human_review" : "serialize",
    explanation: evidence.detail
  };
}

function producerConsumerDetail(
  left: AgentTaskContract | undefined,
  right: AgentTaskContract | undefined
): string | undefined {
  if (left === undefined || right === undefined) return undefined;
  const incompatibleInterface = incompatibleInterfaceDetail(left, right);
  if (incompatibleInterface !== undefined) return incompatibleInterface;

  // A canonical interface seam is the compatibility contract that enables
  // isolated leaves to run in parallel. Only concrete output-symbol flow is a
  // conservative scheduling risk; physical file/import signals are added by
  // conflict-risk when repository grounding proves them.
  const leftProduces = concreteOutputSymbols(left, "produced");
  const leftConsumes = concreteOutputSymbols(left, "consumed");
  const rightProduces = concreteOutputSymbols(right, "produced");
  const rightConsumes = concreteOutputSymbols(right, "consumed");
  const leftToRight = intersectStrings(leftProduces, rightConsumes);
  if (leftToRight.length > 0) {
    return `${right.taskId} consumes concrete output symbols ${leftToRight.join(", ")} produced by ${left.taskId}; serialize unless repository grounding proves the work independent.`;
  }
  const rightToLeft = intersectStrings(rightProduces, leftConsumes);
  if (rightToLeft.length > 0) {
    return `${left.taskId} consumes concrete output symbols ${rightToLeft.join(", ")} produced by ${right.taskId}; serialize unless repository grounding proves the work independent.`;
  }
  return undefined;
}

function incompatibleInterfaceDetail(
  left: AgentTaskContract,
  right: AgentTaskContract
): string | undefined {
  const relationships = [
    [left, right, left.producedInterfaces ?? [], right.consumedInterfaces ?? []],
    [right, left, right.producedInterfaces ?? [], left.consumedInterfaces ?? []]
  ] as const;

  for (const [producer, consumer, produced, consumed] of relationships) {
    for (const producedInterface of produced) {
      const consumedInterface = consumed.find((candidate) => candidate.id === producedInterface.id);
      if (consumedInterface === undefined) continue;
      if (
        producedInterface.kind !== consumedInterface.kind ||
        normalizedSignature(producedInterface.signature) !== normalizedSignature(consumedInterface.signature) ||
        producedInterface.definedAtNodeId !== consumedInterface.definedAtNodeId
      ) {
        return `${producer.taskId} and ${consumer.taskId} declare incompatible declarations for interface ${producedInterface.id}; serialize until the canonical seam is repaired.`;
      }
    }
  }
  return undefined;
}

function normalizedSignature(signature: string): string {
  return signature.replace(/\s+/g, " ").trim();
}

function concreteOutputSymbols(
  contract: AgentTaskContract,
  kind: "produced" | "consumed"
): string[] {
  const interfaceIds = new Set(
    (kind === "produced" ? contract.producedInterfaces : contract.consumedInterfaces)?.map((item) => item.id) ?? []
  );
  const symbols = kind === "produced"
    ? contract.expectedOutput.producedSymbols
    : contract.expectedOutput.consumedSymbols;
  return symbols.filter((symbol) => !interfaceIds.has(symbol));
}

function forEachPair(taskIds: readonly string[], visit: (left: string, right: string) => void): void {
  for (let leftIndex = 0; leftIndex < taskIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < taskIds.length; rightIndex += 1) {
      const left = taskIds[leftIndex];
      const right = taskIds[rightIndex];
      if (left !== undefined && right !== undefined) {
        visit(left, right);
      }
    }
  }
}

function samePair(prediction: ConflictPrediction, taskAId: string, taskBId: string): boolean {
  return pairKey(prediction.taskAId, prediction.taskBId) === pairKey(taskAId, taskBId);
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function riskRank(level: ConflictRiskLevel): number {
  switch (level) {
    case "blocking":
      return 3;
    case "high":
      return 2;
    case "medium":
      return 1;
    case "low":
      return 0;
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, "/")).filter((value) => value.length > 0))];
}

function intersectStrings(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return uniqueStrings(left.filter((value) => rightSet.has(value)));
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
