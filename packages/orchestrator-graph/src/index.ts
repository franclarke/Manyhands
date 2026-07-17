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

export {
  batchHasHighOrBlockingRisk,
  runPlanningFlow
} from "./planning-flow.js";
export type {
  PlanningFlowOptions,
  PlanningFlowResult,
  PlanningRunSummary
} from "./planning-flow.js";

export { V2ExecutionDriver } from "./v2/execution-driver.js";
export type {
  V2ExecutionDriverOptions,
  V2ExecutionRunInput,
  V2ExecutionTarget,
  V2ExecutorProfile,
  V2NodeExecutionInput,
  V2NodeExecutionOutcome,
  V2RepairObservation
} from "./v2/execution-driver.js";

export { JsonFileCheckpointSaver, type ThreadCheckpointHealth } from "./checkpointer.js";
// Re-exported so consumers (web app, tests) can type checkpoints without
// depending on @langchain/langgraph-checkpoint directly.
export type { Checkpoint, CheckpointMetadata, CheckpointTuple } from "@langchain/langgraph-checkpoint";

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
  degradedPlanGateNode,
  makeCriticReviewNode,
  approvalGateNode,
  routeAfterDecompose,
  routeAfterDegraded
} from "./nodes/planning-nodes.js";
export type {
  PlanningGraphDeps,
  DecomposePlanInput,
  DecomposePlanResult,
  PlanCritique,
  PlanCritiqueFinding,
  PlanningQuestionInterrupt,
  PlanApprovalInterrupt,
  PlanDegradedInterrupt,
  PlanningResumeDecision
} from "./nodes/planning-nodes.js";

export {
  prepareExecutionNode,
  waveJoinNode,
  integrationJoinNode,
  makeRouteFrontier,
  makeExecuteLeafNode,
  leafGateNode,
  budgetGateNode,
  computeBudgetSpend,
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
  BudgetGateDecision,
  ResumeDecision,
  LeafValidationInterrupt,
  MergeConflictInterrupt,
  BudgetExceededInterrupt,
  BudgetSpend
} from "./nodes/execution-nodes.js";
