/**
 * Planning StateGraph for the ManyHands LangGraph orchestrator.
 *
 * Topology:
 *   [Start] → initState → decomposeNode ← (resume after answer) ← [QuestionInterrupt]
 *                              │
 *                    (planningQueue empty)
 *                              ↓
 *                          criticNode → [ApprovePlanInterrupt]
 *                              │
 *                         (approved)
 *                              ↓
 *                          [END: status=approved]
 *
 * Design: docs/design/langgraph-orchestrator-design.md §4
 */
import { StateGraph, END, START } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { RunStateAnnotation } from "../state.js";
import {
  initializePlanningNode,
  makeDecomposeNode,
  makeCriticNode,
  type DecomposeNodeDeps,
  type CriticNodeDeps
} from "../nodes/planning-nodes.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

export interface PlanningGraphConfig {
  decomposeDeps: DecomposeNodeDeps;
  criticDeps: CriticNodeDeps;
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Build the planning sub-graph.
 *
 * Uses MemorySaver by default (for tests); production callers should inject
 * JsonFileCheckpointSaver.
 */
export function buildPlanningGraph(config: PlanningGraphConfig) {
  const decomposeNode = makeDecomposeNode(config.decomposeDeps);
  const criticNode = makeCriticNode(config.criticDeps);

  const checkpointer = config.checkpointer ?? new MemorySaver();

  const graph = new StateGraph(RunStateAnnotation)
    .addNode("initState", initializePlanningNode)
    .addNode("decomposeNode", decomposeNode)
    .addNode("criticNode", criticNode)
    // Routing
    .addEdge(START, "initState")
    .addEdge("initState", "decomposeNode")
    .addConditionalEdges("decomposeNode", (state) => {
      // If planning queue is empty → critic; otherwise loop back to keep decomposing
      if (state.planningQueue.length === 0) {
        return "criticNode";
      }
      return "decomposeNode";
    })
    .addEdge("criticNode", END);

  return graph.compile({ checkpointer, interruptBefore: [] });
}

/**
 * Resume a paused planning graph with a user answer.
 * Called by /api/runs/[id]/resume after the user submits their answer.
 */
export async function resumePlanningGraph(params: {
  graph: ReturnType<typeof buildPlanningGraph>;
  threadId: string;
  userAnswers: Record<string, string>;
}) {
  const config = { configurable: { thread_id: params.threadId } };
  return params.graph.stream(
    { userAnswers: params.userAnswers },
    { ...config, streamMode: "updates" }
  );
}
