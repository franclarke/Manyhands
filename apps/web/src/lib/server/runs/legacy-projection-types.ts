import type { AgentRunResult, AgentTaskContract } from "@manyhands/contracts";
import type { StaticConflictSignal, TaskPairRiskMatrix } from "@manyhands/conflict-risk";
import type { DecompositionMode, FeatureRequest } from "@manyhands/decomposer";
import type { PlanningFlowResult, PlanningRunSummary } from "@manyhands/orchestrator-graph";
import type { RepositoryIndexSummary } from "@manyhands/repository-index";
import type { ExecutionBatch, HumanGateResult, SchedulerPlan } from "@manyhands/scheduler";
import type { TaskGraph } from "@manyhands/task-graph";
import type { TraceEvent } from "@manyhands/trace-store";

/** Read-only shape for importing and projecting records written before V2. */
export interface LegacyRunSnapshot {
  runId: string;
  featureId: string;
  status: "planned" | "executed" | "failed";
  decompositionMode: DecompositionMode;
  featureRequest: FeatureRequest;
  graphSnapshot: TaskGraph;
  contracts: AgentTaskContract[];
  riskPredictions: TaskPairRiskMatrix;
  staticConflictSignals: StaticConflictSignal[];
  repositoryIndexSummary?: RepositoryIndexSummary;
  repositoryIndexHash?: string;
  scheduledBatches: ExecutionBatch[];
  blockedTasks: Array<{ taskId: string; reasons: string[] }>;
  agentRunResults: AgentRunResult[];
  scopeValidationResults: LegacyScopeValidationResult[];
  traceEvents: TraceEvent[];
  summary: unknown;
  metadata: {
    schemaVersion: "manyhands.run-snapshot.v1";
    createdAt: string;
    completedAt?: string;
    deterministic: boolean;
    sourceFixture?: string;
    datasetVersion?: string;
    packageVersion?: string;
    inputHash?: string;
    outputHash?: string;
  };
}

export interface LegacyScopeValidationResult {
  taskId: string;
  passed: boolean;
  violations: string[];
}

/** Read-only execution payload accepted only by the V1 import projection. */
export interface LegacyExecutionProjection {
  summary: {
    runId: string;
    featureId: string;
    mode: DecompositionMode;
    planning: PlanningRunSummary;
    execution: Record<string, number>;
    results: AgentRunResult[];
    scopeValidationResults: LegacyScopeValidationResult[];
    humanGate?: HumanGateResult;
    traceEventCount: number;
  };
  planning: PlanningFlowResult;
  results: AgentRunResult[];
  scopeValidationResults: LegacyScopeValidationResult[];
  schedule: SchedulerPlan;
  humanGate?: HumanGateResult;
  traces: TraceEvent[];
  snapshot: LegacyRunSnapshot;
}
