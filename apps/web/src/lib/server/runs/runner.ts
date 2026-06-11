import {
    type PredictedConflictHint,
    type RunExecutionResult
} from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";
import { type TraceStore } from "@manyhands/trace-store";
import {
    type ProvisionedRepo,
    type RepoProvisioner
} from "./repo-provisioner";
import { type RunTitle } from "./run-titler";
import type {
    ExecutionConfigInput,
    RunRecord
} from "./schema";

export { computeInvalidatedTasks } from "./execution-state";
export type { ExecutionResults } from "./execution-state";


// Re-export for the SSE endpoint to detect orphaned runs.
export { isRunnerActive } from "./runner-state";

export interface PlanningRunnerOptions {
  intervalMs?: number;
  /** Injectable for tests; defaults to the real Gemini-backed titler. */
  titler?: (input: { userPrompt: string; model: string }) => Promise<RunTitle>;
}

/**
 * Execution seam (C17). The pipeline resolves the graph and maps results to
 * SSE; the engine owns the actual run. The default engine drives the real
 * RunExecutor against a git repo, but tests (and future provisioning layers)
 * can inject their own to stay deterministic without disk/network/Codex.
 */
export interface ExecutionEngineInput {
  graph: TaskGraph;
  model: string;
  defaultExecutionSelection?: RunRecord["defaultExecutionSelection"];
  defaultRepairSelection?: RunRecord["defaultRepairSelection"];
  runId: string;
  /** Trace sink owned by the web runner; engines append here for live UI updates and persisted evidence. */
  traceStore?: TraceStore;
  /** Real repo provisioned for this run (C17). Required by the default engine. */
  provisioned?: ProvisionedRepo;
  /** Optional per-run config overrides; defaults applied by the engine. */
  executionConfig?: ExecutionConfigInput;
  /** Run-level cancellation: aborts in-flight executors and stops scheduling. */
  signal?: AbortSignal;
  /** Awaited at each batch boundary (pause hold); resolves to continue. */
  onBatchBoundary?: () => Promise<void>;
  /** Conflicts predicted at planning time; feed the conflict-aware composer (D8). */
  predictedConflicts?: PredictedConflictHint[];
}

export interface ExecutionEngine {
  run(input: ExecutionEngineInput): Promise<RunExecutionResult>;
}

export interface ExecutionRunnerOptions {
  intervalMs?: number;
  engine?: ExecutionEngine;
  /** Injectable for tests; default copies a benchmark fixture into a per-run dir. */
  provisioner?: RepoProvisioner;
  /** Injectable for tests; receives the engine's trace events to persist as evidence. */
  traceStore?: TraceStore;
}


/**
 * Build a FeatureRequest from the user's natural-language prompt.
 */
export * from "./execution-pipeline";
export * from "./planning-pipeline";
export * from "./replan-service";
