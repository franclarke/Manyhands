/**
 * LangGraph state annotation for the ManyHands orchestrator.
 *
 * This module defines the unified channels annotation (RunStateAnnotation)
 * that represents the full orchestrator state across planning, execution,
 * and integration phases.
 *
 * Execution results use identity-merge reducers (last write per task wins) so
 * a retried leaf REPLACES its failed result instead of accumulating duplicates.
 *
 * Design: docs/design/langgraph-orchestrator-design.md §3
 */
import { Annotation } from "@langchain/langgraph";
import type { TaskGraph } from "@manyhands/task-graph";
import type { AgentExecutionResult, IntegrationResult } from "@manyhands/execution-core";

/** Merge two result arrays by identity key; incoming entries replace existing ones. */
function mergeById<T>(keyOf: (item: T) => string): (existing: T[], incoming: T[]) => T[] {
  return (existing, incoming) => {
    if (incoming.length === 0) return existing;
    const merged = new Map(existing.map((item) => [keyOf(item), item]));
    for (const item of incoming) {
      merged.set(keyOf(item), item);
    }
    return [...merged.values()];
  };
}

/** Set-union reducer for accepted-failure id lists. */
function unionIds(existing: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return existing;
  return [...new Set([...existing, ...incoming])];
}

export const RunStateAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  userPrompt: Annotation<string>(),
  workspaceId: Annotation<string>(),
  repoPath: Annotation<string>(),

  // The dynamically generated TaskGraph (software DAG).
  // Named taskGraph (not `graph`) so Command instances returned by gate nodes
  // don't structurally collide with Command's own `graph?: string` property.
  taskGraph: Annotation<TaskGraph | null>(),

  // Resumable decomposer state (opaque step cache keyed by node id).
  planningStepCache: Annotation<Record<string, unknown>>(),

  // Deterministic critic verdict over the finished plan (set by criticReview,
  // surfaced in the approval gate's interrupt payload).
  planCritique: Annotation<{
    findings: Array<{ severity: string; message: string; source: "plan" | "seam"; code?: string }>;
    errorCount: number;
  } | null>(),

  // Accumulated execution results — identity merge so retries replace failures
  leafResults: Annotation<AgentExecutionResult[]>({
    reducer: mergeById((result) => result.taskId),
    default: () => []
  }),
  integrationResults: Annotation<IntegrationResult[]>({
    reducer: mergeById((result) => result.compositeTaskId),
    default: () => []
  }),

  // Failures the human explicitly accepted via the leaf/conflict gates.
  // Accepting unblocks the frontier; the run still finishes as "failed".
  acceptedLeafFailures: Annotation<string[]>({
    reducer: unionIds,
    default: () => []
  }),
  acceptedIntegrationFailures: Annotation<string[]>({
    reducer: unionIds,
    default: () => []
  }),

  // Human-in-the-loop variables (planning phase)
  pendingQuestion: Annotation<{ nodeId: string; question: string; options: string[] } | null>(),
  userAnswers: Annotation<Record<string, string>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({})
  }),

  status: Annotation<"created" | "planning" | "needs_review" | "approved" | "running" | "completed" | "failed">(),
  errorMessage: Annotation<string | null>()
});

export type RunState = typeof RunStateAnnotation.State;
export type RunStateUpdate = typeof RunStateAnnotation.Update;
