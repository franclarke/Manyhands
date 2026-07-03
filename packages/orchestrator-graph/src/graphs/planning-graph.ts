/**
 * Planning StateGraph for the ManyHands LangGraph orchestrator (v2).
 *
 * Topology:
 *   START → decomposePlan ─[routeAfterDecompose]→ questionGate | criticReview
 *   questionGate → decomposePlan        (answer merged, decomposer continues
 *                                        from its step cache)
 *   criticReview → approvalGate → END   (approve → status "approved",
 *                                        reject → status "needs_review")
 *
 * The expensive decomposer node never interrupts; both HITL points are cheap
 * gate nodes resumed natively with Command({ resume }) — identical to the
 * execution graph's leaf/conflict gates, so checkpoints are never hand-edited.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { RunStateAnnotation } from "../state.js";
import {
  approvalGateNode,
  degradedPlanGateNode,
  makeCriticReviewNode,
  makeDecomposePlanNode,
  questionGateNode,
  routeAfterDecompose,
  routeAfterDegraded,
  type PlanningGraphDeps
} from "../nodes/planning-nodes.js";

export type {
  DecomposePlanInput,
  DecomposePlanResult,
  PlanApprovalInterrupt,
  PlanCritique,
  PlanCritiqueFinding,
  PlanDegradedInterrupt,
  PlanningGraphDeps,
  PlanningQuestionInterrupt,
  PlanningResumeDecision
} from "../nodes/planning-nodes.js";

export interface PlanningGraphConfig {
  deps: PlanningGraphDeps;
  /** Production callers inject JsonFileCheckpointSaver; tests default to memory. */
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Planning threads live next to the execution thread (thread_id = runId) but
 * never collide with it. The suffix is filesystem-safe on every platform.
 */
export const PLANNING_THREAD_SUFFIX = "__planning";

export function planningThreadId(runId: string): string {
  return `${runId}${PLANNING_THREAD_SUFFIX}`;
}

export function buildPlanningGraph(config: PlanningGraphConfig) {
  const checkpointer = config.checkpointer ?? new MemorySaver();

  const graph = new StateGraph(RunStateAnnotation)
    .addNode("decomposePlan", makeDecomposePlanNode(config.deps))
    .addNode("questionGate", questionGateNode)
    .addNode("degradedPlanGate", degradedPlanGateNode)
    .addNode("criticReview", makeCriticReviewNode(config.deps))
    .addNode("approvalGate", approvalGateNode)
    .addEdge(START, "decomposePlan")
    .addConditionalEdges("decomposePlan", routeAfterDecompose, [
      "questionGate",
      "degradedPlanGate",
      "criticReview"
    ])
    .addEdge("questionGate", "decomposePlan")
    .addConditionalEdges("degradedPlanGate", routeAfterDegraded, ["decomposePlan", END])
    .addEdge("criticReview", "approvalGate")
    .addEdge("approvalGate", END);

  return graph.compile({ checkpointer });
}
