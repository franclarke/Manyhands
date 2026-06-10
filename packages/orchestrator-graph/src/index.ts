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

export { buildPlanningGraph, resumePlanningGraph } from "./graphs/planning-graph.js";
export type { PlanningGraphConfig } from "./graphs/planning-graph.js";

export { buildExecutionGraph } from "./graphs/execution-graph.js";
export type { ExecutionGraphConfig } from "./graphs/execution-graph.js";

export {
  initializePlanningNode,
  makeDecomposeNode,
  makeCriticNode
} from "./nodes/planning-nodes.js";
export type {
  DecomposeNodeDeps,
  CriticNodeDeps,
  DecomposeTaskResult,
  CriticResult
} from "./nodes/planning-nodes.js";

export {
  makeScheduleBatchesNode,
  executeBatchNode,
  makeExecuteLeafNode,
  makeIntegrateCompositeNode,
  makeRunValidationNode
} from "./nodes/execution-nodes.js";
export type {
  ScheduleBatchesNodeDeps,
  ExecuteLeafNodeDeps,
  IntegrateCompositeNodeDeps,
  RunValidationNodeDeps,
  LeafExecutionInput
} from "./nodes/execution-nodes.js";
