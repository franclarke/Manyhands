/**
 * LangGraph state annotation for the ManyHands orchestrator.
 *
 * This module defines the unified channels annotation (RunStateAnnotation)
 * that represents the full orchestrator state across planning, execution,
 * and integration phases.
 *
 * Design: docs/design/langgraph-orchestrator-design.md §3
 */
import { Annotation } from "@langchain/langgraph";
import type { TaskGraph } from "@manyhands/task-graph";
import type { AgentExecutionResult, IntegrationResult } from "@manyhands/execution-core";

export const RunStateAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  userPrompt: Annotation<string>(),
  workspaceId: Annotation<string>(),
  repoPath: Annotation<string>(),

  // The dynamically generated TaskGraph (software DAG)
  graph: Annotation<TaskGraph | null>(),

  // Queues and caching for decomposition
  planningQueue: Annotation<string[]>(),
  planningStepCache: Annotation<Record<string, unknown>>(),

  // Execution scheduler state
  currentBatchIndex: Annotation<number>(),
  batches: Annotation<string[][]>(), // array of batches containing task IDs

  // Accumulated results — reducer merges incoming arrays
  leafResults: Annotation<AgentExecutionResult[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),
  integrationResults: Annotation<IntegrationResult[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  // Human-in-the-loop variables
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
