import path from "node:path";
import type { AgentRunResult } from "@manyhands/contracts";
import {
  contractsByTaskId,
  type DecompositionMode
} from "@manyhands/decomposer";
import {
  makeRunSnapshotMetadata,
  withRunSnapshotHashes,
  writeRunSnapshotFile,
  type RunSnapshot
} from "@manyhands/run-store";
import {
  validateScope,
  type ScopeValidationResult
} from "@manyhands/scope-validation";
import {
  applyHumanGateToSchedule,
  type HumanGateResult,
  type SchedulerPlan
} from "@manyhands/scheduler";
import {
  InMemoryTraceStore,
  type TraceEvent,
  type TraceStore
} from "@manyhands/trace-store";
import {
  createMockWorktreeSession,
  MockWorktreeRunner,
  type AgentInvocation,
  type AgentRunner,
  type MockWorktreeRunnerOptions
} from "@manyhands/worktree-runner";
import {
  runMockPlanningFlow,
  type MockPlanningFlowOptions,
  type MockPlanningFlowResult,
  type PlanningRunSummary
} from "./mock-planning-flow";

export interface MockExecutionFlowOptions extends MockPlanningFlowOptions {
  runner?: AgentRunner;
  runnerOptions?: MockWorktreeRunnerOptions;
  datasetVersion?: string;
  humanGate?: boolean;
}

export interface MockExecutionMetrics {
  totalTasks: number;
  executedTasks: number;
  succeededTasks: number;
  failedTasks: number;
  scopeValidTasks: number;
  scopeViolationCount: number;
  batchesExecuted: number;
  simulatedDiffCount: number;
  validationCommandCount: number;
}

export interface MockExecutionSummary {
  runId: string;
  featureId: string;
  mode: DecompositionMode;
  planning: PlanningRunSummary;
  execution: MockExecutionMetrics;
  results: AgentRunResult[];
  scopeValidationResults: ScopeValidationResult[];
  humanGate?: HumanGateResult;
  traceEventCount: number;
}

export interface MockExecutionFlowResult {
  summary: MockExecutionSummary;
  planning: MockPlanningFlowResult;
  results: AgentRunResult[];
  scopeValidationResults: ScopeValidationResult[];
  schedule: SchedulerPlan;
  humanGate?: HumanGateResult;
  traces: TraceEvent[];
  snapshot: RunSnapshot;
}

export async function runMockExecutionFlow(
  options: MockExecutionFlowOptions = {}
): Promise<MockExecutionFlowResult> {
  const traceStore = options.traceStore ?? new InMemoryTraceStore();
  const planning = await runMockPlanningFlow({
    ...options,
    traceStore
  });
  const runner = options.runner ?? new MockWorktreeRunner(options.runnerOptions);
  const contracts = contractsByTaskId(planning.decomposition.contracts);
  const runLabel = options.runLabel ?? planning.summary.mode;
  const runId = `${planning.summary.featureId}:${runLabel}:mock-execution-run`;
  const planId = `${planning.summary.featureId}:${runLabel}:plan`;
  const results: AgentRunResult[] = [];
  const scopeValidationResults: ScopeValidationResult[] = [];
  const humanGate = options.humanGate === true
    ? applyHumanGateToSchedule({
        plan: planning.schedule,
        riskMatrix: planning.riskMatrix
      })
    : undefined;
  const schedule = humanGate?.plan ?? planning.schedule;

  try {
    if (humanGate !== undefined) {
      recordHumanGateTraceEvents(traceStore, planId, humanGate);
    }

    traceStore.append({
      type: "execution_started",
      actor: "system",
      planId,
      payload: {
        runId,
        planningRunId: planning.summary.runId,
        batchCount: schedule.batches.length,
        humanGateEnabled: humanGate !== undefined
      }
    });

    for (const batch of schedule.batches) {
      traceStore.append({
        type: "batch_execution_started",
        actor: "system",
        planId,
        payload: {
          batchId: batch.id,
          taskIds: batch.taskIds
        }
      });

      for (const taskId of batch.taskIds) {
        const contract = contracts[taskId];

        if (!contract) {
          throw new Error(`Missing contract for scheduled task ${taskId}`);
        }

        traceStore.append({
          type: "task_execution_started",
          actor: "system",
          planId,
          taskId,
          payload: {
            batchId: batch.id
          }
        });

        const worktree = createMockWorktreeSession(taskId, {
          baseCommit: planning.decomposition.graph.baseCommit
        });

        traceStore.append({
          type: "mock_worktree_created",
          actor: "system",
          planId,
          taskId,
          payload: {
            branch: worktree.branch,
            path: worktree.path,
            baseCommit: worktree.baseCommit
          }
        });
        traceStore.append({
          type: "agent_run_started",
          actor: "system",
          planId,
          taskId,
          payload: {
            runner: "mock"
          }
        });

        const invocation: AgentInvocation = {
          contract,
          worktree,
          model: "mock-agent",
          promptPreview: `Mock execution for ${contract.taskId}: ${contract.objective}`
        };
        const result = await runner.run(invocation);
        const executedValidationCommands = result.validation.checks
          .filter((check) => check.command !== undefined && check.passed)
          .map((check) => check.command)
          .filter((command): command is string => command !== undefined);
        const scopeValidation = validateScope({
          contract,
          changedFiles: result.changedFiles,
          reportedSymbols: result.reportedSymbols,
          executedValidationCommands
        });

        results.push(result);
        scopeValidationResults.push(scopeValidation);

        traceStore.append({
          type: result.success ? "agent_run_completed" : "agent_run_failed",
          actor: "agent",
          planId,
          taskId,
          payload: {
            success: result.success,
            changedFiles: result.changedFiles,
            scopeViolations: result.scopeViolations
          }
        });
        traceStore.append({
          type: "scope_validated",
          actor: "system",
          planId,
          taskId,
          payload: {
            valid: scopeValidation.valid,
            violations: scopeValidation.violations,
            warnings: scopeValidation.warnings
          }
        });
      }

      traceStore.append({
        type: "batch_execution_completed",
        actor: "system",
        planId,
        payload: {
          batchId: batch.id,
          taskIds: batch.taskIds
        }
      });
    }

    const summaryInput: Omit<MockExecutionSummary, "execution"> = {
      runId,
      featureId: planning.summary.featureId,
      mode: planning.summary.mode,
      planning: planning.summary,
      results,
      scopeValidationResults,
      traceEventCount: traceStore.list().length + 1
    };

    if (humanGate !== undefined) {
      summaryInput.humanGate = humanGate;
    }

    const summary = buildExecutionSummary(summaryInput);

    traceStore.append({
      type: "execution_completed",
      actor: "system",
      planId,
      payload: {
        summary
      }
    });

    const traces = traceStore.list();
    const resultWithoutSnapshot = {
      summary,
      planning,
      results,
      scopeValidationResults,
      schedule,
      ...(humanGate ? { humanGate } : {}),
      traces
    };

    const snapshotOptions: { sourceFixture?: string; datasetVersion?: string } = {};

    if (options.fixturePath !== undefined) {
      snapshotOptions.sourceFixture = options.fixturePath;
    }

    if (options.datasetVersion !== undefined) {
      snapshotOptions.datasetVersion = options.datasetVersion;
    }

    return {
      ...resultWithoutSnapshot,
      snapshot: buildMockExecutionRunSnapshot(resultWithoutSnapshot, snapshotOptions)
    };
  } catch (error) {
    traceStore.append({
      type: "execution_failed",
      actor: "system",
      planId,
      payload: {
        runId,
        message: error instanceof Error ? error.message : String(error)
      }
    });

    throw error;
  }
}

export async function exportMockExecutionRun(
  result: MockExecutionFlowResult,
  exportPath: string
): Promise<void> {
  const absolutePath = path.resolve(exportPath);
  await writeRunSnapshotFile(result.snapshot, absolutePath);
}

export function buildMockExecutionRunSnapshot(
  result: Omit<MockExecutionFlowResult, "snapshot">,
  options: { sourceFixture?: string; datasetVersion?: string } = {}
): RunSnapshot {
  const completedAt =
    result.results[result.results.length - 1]?.completedAt ??
    result.planning.decomposition.metadata.generatedAt;
  const metadataInput: Parameters<typeof makeRunSnapshotMetadata>[0] = {
    deterministic: result.planning.decomposition.metadata.deterministic,
    createdAt: result.planning.decomposition.metadata.generatedAt,
    completedAt,
    datasetVersion: options.datasetVersion ?? "passwordless-login.fixture.v1",
    packageVersion: "0.1.0"
  };

  if (options.sourceFixture !== undefined) {
    metadataInput.sourceFixture = options.sourceFixture;
  }

  const metadata = makeRunSnapshotMetadata(metadataInput);
  const status = result.summary.execution.failedTasks > 0 ? "failed" : "executed";

  const snapshotInput: RunSnapshot = {
    runId: result.summary.runId,
    featureId: result.summary.featureId,
    status,
    decompositionMode: result.summary.mode,
    featureRequest: result.planning.decomposition.feature,
    graphSnapshot: result.planning.decomposition.graph,
    contracts: result.planning.decomposition.contracts,
    riskPredictions: result.planning.riskMatrix,
    staticConflictSignals: result.planning.staticConflictSignals,
    scheduledBatches: result.schedule.batches,
    blockedTasks: result.schedule.blocked,
    agentRunResults: result.results,
    scopeValidationResults: result.scopeValidationResults,
    traceEvents: result.traces,
    summary: result.summary,
    metadata
  };

  if (result.planning.repositoryIndexSummary !== undefined) {
    snapshotInput.repositoryIndexSummary = result.planning.repositoryIndexSummary;
  }

  if (result.planning.repositoryIndexHash !== undefined) {
    snapshotInput.repositoryIndexHash = result.planning.repositoryIndexHash;
  }

  return withRunSnapshotHashes(snapshotInput);
}

function buildExecutionSummary(input: Omit<MockExecutionSummary, "execution">): MockExecutionSummary {
  const scopeViolationCount = input.scopeValidationResults.reduce(
    (total, result) => total + result.violations.length,
    0
  );

  return {
    ...input,
    execution: {
      totalTasks: input.planning.leafCount,
      executedTasks: input.results.length,
      succeededTasks: input.results.filter((result) => result.success).length,
      failedTasks: input.results.filter((result) => !result.success).length,
      scopeValidTasks: input.scopeValidationResults.filter((result) => result.valid).length,
      scopeViolationCount,
      batchesExecuted: input.humanGate?.plan.batches.length ?? input.planning.batchCount,
      simulatedDiffCount: input.results.filter((result) => result.diff.trim().length > 0).length,
      validationCommandCount: input.results.reduce(
        (total, result) => total + result.validation.checks.filter((check) => check.command !== undefined).length,
        0
      )
    }
  };
}

function recordHumanGateTraceEvents(
  traceStore: TraceStore,
  planId: string,
  humanGate: HumanGateResult
): void {
  if (humanGate.metrics.gateRequiredCount > 0) {
    traceStore.append({
      type: "human_gate_required",
      actor: "system",
      planId,
      payload: {
        metrics: humanGate.metrics,
        decisionCount: humanGate.decisions.length
      }
    });
  }

  for (const decision of humanGate.decisions) {
    traceStore.append({
      type: "human_gate_decision_recorded",
      actor: decision.kind === "requires_manual_review" ? "human" : "system",
      planId,
      payload: {
        decision
      }
    });

    if (decision.kind === "serialized" || decision.kind === "serialized_after_mock_review") {
      for (const taskId of decision.taskIds) {
        traceStore.append({
          type: "task_serialized_by_gate",
          actor: "system",
          planId,
          taskId,
          payload: {
            decisionId: decision.id,
            riskLevel: decision.riskLevel
          }
        });
      }
    }

    if (decision.kind === "blocked") {
      for (const taskId of decision.taskIds) {
        traceStore.append({
          type: "task_blocked_by_gate",
          actor: "system",
          planId,
          taskId,
          payload: {
            decisionId: decision.id,
            riskLevel: decision.riskLevel
          }
        });
      }
    }
  }

  if (humanGate.explanations.length > 0) {
    traceStore.append({
      type: "batch_modified_by_gate",
      actor: "system",
      planId,
      payload: {
        explanations: humanGate.explanations,
        batchCount: humanGate.plan.batches.length
      }
    });
  }
}
