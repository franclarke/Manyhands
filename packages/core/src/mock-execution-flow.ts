/**
 * Type-only legacy surface kept for backward compatibility with apps/web,
 * which still narrows `RunRecord.execution` against `MockExecutionFlowResult`
 * to distinguish legacy Lab-mode execution payloads from `RunExecutionResult`.
 *
 * The runtime mock execution flow is gone — Lab Mode no longer exists. New
 * code should not depend on these types; they are kept only to avoid mass
 * refactors in the projection layer until that code is rewritten against
 * `RunExecutionResult` exclusively.
 */
import type { AgentRunResult } from "@manyhands/contracts";
import type { DecompositionMode } from "@manyhands/decomposer";
import type { RunSnapshot, ScopeValidationResult } from "@manyhands/run-store";
import type { HumanGateResult, SchedulerPlan } from "@manyhands/scheduler";
import type { TraceEvent } from "@manyhands/trace-store";
import type { MockPlanningFlowResult, PlanningRunSummary } from "./mock-planning-flow";

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
