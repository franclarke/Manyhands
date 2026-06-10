/**
 * @manyhands/orchestrator-graph — public API barrel.
 *
 * Exports the LangGraph-based orchestrator for ManyHands:
 *   - State schema (RunStateAnnotation)
 *   - JsonFileCheckpointSaver
 *   - Planning graph builder
 *   - Execution graph builder
 *   - Node factories (for testing and custom wiring)
 */
export { RunStateAnnotation } from "./state.js";
export type { RunState, RunStateUpdate } from "./state.js";

export { JsonFileCheckpointSaver } from "./checkpointer.js";

export {
  buildPlanningGraph,
  planningThreadId,
  PLANNING_THREAD_SUFFIX
} from "./graphs/planning-graph.js";
export type { PlanningGraphConfig } from "./graphs/planning-graph.js";

export { buildExecutionGraph, executionRecursionLimit } from "./graphs/execution-graph.js";
export type { ExecutionGraphConfig } from "./graphs/execution-graph.js";

export {
  makeDecomposePlanNode,
  questionGateNode,
  makeCriticReviewNode,
  approvalGateNode,
  routeAfterDecompose
} from "./nodes/planning-nodes.js";
export type {
  PlanningGraphDeps,
  DecomposePlanInput,
  DecomposePlanResult,
  PlanCritique,
  PlanCritiqueFinding,
  PlanningQuestionInterrupt,
  PlanApprovalInterrupt,
  PlanningResumeDecision
} from "./nodes/planning-nodes.js";

export {
  prepareExecutionNode,
  waveJoinNode,
  integrationJoinNode,
  makeRouteFrontier,
  makeExecuteLeafNode,
  leafGateNode,
  routeIntegration,
  makeIntegrateNextCompositeNode,
  conflictGateNode,
  makeRunValidationNode
} from "./nodes/execution-nodes.js";
export type {
  FrontierRouterDeps,
  ExecuteLeafNodeDeps,
  IntegrateCompositeNodeDeps,
  RunValidationNodeDeps,
  LeafExecutionInput,
  LeafGateDecision,
  ConflictGateDecision,
  ResumeDecision,
  LeafValidationInterrupt,
  MergeConflictInterrupt
} from "./nodes/execution-nodes.js";
