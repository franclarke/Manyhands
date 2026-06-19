import {
  buildStaticConflictSignals,
  buildTaskPairRiskMatrix,
  findRiskPrediction,
  type StaticConflictSignal,
  type TaskPairRiskMatrix
} from "@manyhands/conflict-risk";
import {
  contractsByTaskId,
  MockDecomposer,
  type Decomposer,
  type DecompositionMode,
  type DecompositionResult,
  type FeatureRequest
} from "@manyhands/decomposer";
import {
  computeRepositoryIndexHash,
  summarizeRepositoryIndex,
  type RepositoryIndex,
  type RepositoryIndexSummary
} from "@manyhands/repository-index";
import {
  scheduleTasks,
  type ExecutionBatch,
  type SchedulerPlan,
  type SchedulingPolicy
} from "@manyhands/scheduler";
import { getLeafNodes, validateTaskGraph } from "@manyhands/task-graph";
import {
  InMemoryTraceStore,
  type TraceEvent,
  type TraceStore
} from "@manyhands/trace-store";
import { AgentTaskContractSchema } from "@manyhands/contracts";
import { readFile } from "node:fs/promises";
import { FeatureRequestSchema } from "@manyhands/decomposer";

export interface MockPlanningFlowOptions {
  feature?: FeatureRequest;
  fixturePath?: string;
  mode?: DecompositionMode;
  maxParallel?: number;
  generatedAt?: string;
  traceStore?: TraceStore;
  decomposer?: Decomposer;
  repositoryIndex?: RepositoryIndex;
  schedulerPolicy?: SchedulingPolicy;
  runLabel?: string;
  questionAnswers?: Record<string, string> | undefined;
  stepCache?: Record<string, any> | undefined;
}

export interface PlanningRunSummary {
  runId: string;
  featureId: string;
  mode: DecompositionMode;
  schedulerPolicy: SchedulingPolicy;
  taskCount: number;
  leafCount: number;
  dependencyCount: number;
  contractCount: number;
  riskPredictionCount: number;
  staticConflictSignalCount: number;
  batchCount: number;
  batches: ExecutionBatch[];
  traceEventCount: number;
  validationIssues: string[];
}

export interface MockPlanningFlowResult {
  summary: PlanningRunSummary;
  decomposition: DecompositionResult;
  riskMatrix: TaskPairRiskMatrix;
  staticConflictSignals: StaticConflictSignal[];
  repositoryIndexSummary?: RepositoryIndexSummary;
  repositoryIndexHash?: string;
  schedule: SchedulerPlan;
  traces: TraceEvent[];
}

const DEFAULT_MODE: DecompositionMode = "balanced";
const DEFAULT_MAX_PARALLEL = 3;

export async function runMockPlanningFlow(
  options: MockPlanningFlowOptions = {}
): Promise<MockPlanningFlowResult> {
  const mode = options.mode ?? DEFAULT_MODE;
  const schedulerPolicy = options.schedulerPolicy ?? "risk_aware";
  const traceStore = options.traceStore ?? new InMemoryTraceStore();
  const decomposer = options.decomposer ?? new MockDecomposer();
  const feature = options.feature ?? (await loadFixtureFromOptions(options));
  const runLabel = options.runLabel ?? mode;
  const runId = `${feature.id}:${runLabel}:mock-planning-run`;
  const planId = `${feature.id}:${runLabel}:plan`;

  try {
    traceStore.append({
      type: "feature_loaded",
      actor: "system",
      planId,
      payload: {
        featureId: feature.id,
        fixturePath: options.fixturePath ?? null
      }
    });
    traceStore.append({
      type: "decomposition_started",
      actor: "system",
      planId,
      payload: {
        featureId: feature.id,
        mode,
        schedulerPolicy
      }
    });

    const decomposition = await decomposer.decompose(
      feature,
      {
        mode,
        generatedAt: options.generatedAt,
        questionAnswers: options.questionAnswers,
        stepCache: options.stepCache
      }
    );
    const graphIssues = validateTaskGraph(decomposition.graph).map((issue) => `${issue.code}: ${issue.message}`);
    const contractIssues = decomposition.contracts.flatMap((contract) => {
      const parsed = AgentTaskContractSchema.safeParse(contract);

      if (parsed.success) {
        return [];
      }

      return parsed.error.issues.map((issue) => `${contract.taskId}.${issue.path.join(".")}: ${issue.message}`);
    });
    const validationIssues = [
      ...decomposition.validation.issues,
      ...graphIssues,
      ...contractIssues
    ];

    traceStore.append({
      type: "graph_created",
      actor: "system",
      planId,
      payload: {
        graphId: decomposition.graph.id,
        taskCount: Object.keys(decomposition.graph.nodes).length,
        dependencyCount: decomposition.graph.dependencies.length
      }
    });

    for (const contract of decomposition.contracts) {
      traceStore.append({
        type: "contract_created",
        actor: "system",
        planId,
        taskId: contract.taskId,
        payload: {
          changedFiles: contract.expectedOutput.changedFiles,
          producedSymbols: contract.expectedOutput.producedSymbols,
          consumedSymbols: contract.expectedOutput.consumedSymbols
        }
      });
    }

    traceStore.append({
      type: "graph_validated",
      actor: "system",
      planId,
      payload: {
        graphValid: graphIssues.length === 0,
        issues: graphIssues
      }
    });
    traceStore.append({
      type: "contract_validated",
      actor: "system",
      planId,
      payload: {
        contractValid: contractIssues.length === 0,
        contractCount: decomposition.contracts.length,
        issues: contractIssues
      }
    });

    if (validationIssues.length > 0) {
      traceStore.append({
        type: "planning_run_failed",
        actor: "system",
        planId,
        payload: {
          runId,
          validationIssues
        }
      });
      throw new Error(`Mock planning flow validation failed: ${validationIssues.join("; ")}`);
    }

    const contracts = contractsByTaskId(decomposition.contracts);
    const staticConflictSignals = options.repositoryIndex
      ? buildStaticConflictSignals({ contracts, repositoryIndex: options.repositoryIndex })
      : [];
    const repositoryIndexSummary = options.repositoryIndex
      ? summarizeRepositoryIndex(options.repositoryIndex)
      : undefined;
    const repositoryIndexHash = options.repositoryIndex
      ? computeRepositoryIndexHash(options.repositoryIndex)
      : undefined;

    if (options.repositoryIndex) {
      traceStore.append({
        type: "repository_index_loaded",
        actor: "system",
        planId,
        payload: {
          repositoryId: options.repositoryIndex.repositoryId,
          repositoryIndexHash,
          fileCount: options.repositoryIndex.files.length,
          symbolCount: options.repositoryIndex.symbols.length
        }
      });
      traceStore.append({
        type: "static_conflict_signals_generated",
        actor: "system",
        planId,
        payload: {
          signalCount: staticConflictSignals.length,
          highSignalCount: staticConflictSignals.filter((signal) => signal.severity === "high").length,
          blockingSignalCount: staticConflictSignals.filter((signal) => signal.severity === "blocking").length
        }
      });
    }

    const riskMatrix = buildTaskPairRiskMatrix({ contracts, staticSignals: staticConflictSignals });
    traceStore.append({
      type: "risk_predicted",
      actor: "system",
      planId,
      payload: {
        riskPredictionCount: riskMatrix.length,
        highRiskCount: riskMatrix.filter((prediction) => prediction.level === "high").length,
        blockingRiskCount: riskMatrix.filter((prediction) => prediction.level === "blocking").length
      }
    });

    const schedule = scheduleTasks({
      graph: decomposition.graph,
      contracts,
      riskMatrix,
      ...(staticConflictSignals.length > 0 ? { staticSignals: staticConflictSignals } : {}),
      maxParallel: options.maxParallel ?? DEFAULT_MAX_PARALLEL,
      policy: schedulerPolicy
    });

    for (const batch of schedule.batches) {
      traceStore.append({
        type: "batch_scheduled",
        actor: "system",
        planId,
        payload: {
          batchId: batch.id,
          taskIds: batch.taskIds,
          rationale: batch.rationale
        }
      });
    }

    const summary: PlanningRunSummary = {
      runId,
      featureId: feature.id,
      mode,
      schedulerPolicy,
      taskCount: Object.keys(decomposition.graph.nodes).length,
      leafCount: getLeafNodes(decomposition.graph).length,
      dependencyCount: decomposition.graph.dependencies.length,
      contractCount: decomposition.contracts.length,
      riskPredictionCount: riskMatrix.length,
      staticConflictSignalCount: staticConflictSignals.length,
      batchCount: schedule.batches.length,
      batches: schedule.batches,
      traceEventCount: traceStore.list().length + 1,
      validationIssues
    };

    traceStore.append({
      type: "planning_run_completed",
      actor: "system",
      planId,
      payload: {
        summary
      }
    });

    return {
      summary,
      decomposition,
      riskMatrix,
      staticConflictSignals,
      ...(repositoryIndexSummary ? { repositoryIndexSummary } : {}),
      ...(repositoryIndexHash ? { repositoryIndexHash } : {}),
      schedule,
      traces: traceStore.list()
    };
  } catch (error) {
    if (!traceStore.findByType("planning_run_failed").some((event) => event.planId === planId)) {
      traceStore.append({
        type: "planning_run_failed",
        actor: "system",
        planId,
        payload: {
          runId,
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }

    throw error;
  }
}

export function batchHasHighOrBlockingRisk(
  batch: ExecutionBatch,
  riskMatrix: TaskPairRiskMatrix
): boolean {
  for (let leftIndex = 0; leftIndex < batch.taskIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < batch.taskIds.length; rightIndex += 1) {
      const left = batch.taskIds[leftIndex];
      const right = batch.taskIds[rightIndex];

      if (!left || !right) {
        continue;
      }

      const risk = findRiskPrediction(riskMatrix, left, right);

      if (risk?.level === "high" || risk?.level === "blocking") {
        return true;
      }
    }
  }

  return false;
}

async function loadFixtureFromOptions(options: MockPlanningFlowOptions): Promise<FeatureRequest> {
  if (!options.fixturePath) {
    throw new Error("runMockPlanningFlow requires either feature or fixturePath");
  }

  const raw = await readFile(options.fixturePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return FeatureRequestSchema.parse(parsed);
}
