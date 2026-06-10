/**
 * Execution StateGraph for the ManyHands LangGraph orchestrator.
 *
 * Topology:
 *   [Start] → scheduleBatches → executeBatch (Send → parallel executeLeafNode)
 *                │                    ↑
 *           (batch loop)              │ (map-reduce)
 *                │                   ↓
 *           (all batches done) → integrateComposite → runValidation → [END]
 *
 * Parallel execution uses LangGraph's Send pattern (D9: maxParallel=6).
 * HITL interrupts on leaf validation failure (after 1 auto-repair attempt)
 * and on unresolvable merge conflicts (D8).
 *
 * Design: docs/design/langgraph-orchestrator-design.md §4
 */
import { StateGraph, END, START, Send } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { RunStateAnnotation } from "../state.js";
import {
  makeScheduleBatchesNode,
  executeBatchNode,
  makeExecuteLeafNode,
  makeIntegrateCompositeNode,
  makeRunValidationNode,
  type ScheduleBatchesNodeDeps,
  type ExecuteLeafNodeDeps,
  type IntegrateCompositeNodeDeps,
  type RunValidationNodeDeps,
  type LeafExecutionInput
} from "../nodes/execution-nodes.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

export interface ExecutionGraphConfig {
  scheduleDeps: ScheduleBatchesNodeDeps;
  leafDeps: ExecuteLeafNodeDeps;
  integrateDeps: IntegrateCompositeNodeDeps;
  validationDeps: RunValidationNodeDeps;
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Build the execution sub-graph.
 *
 * The executeBatchNode uses Send to dispatch leaf tasks in parallel.
 * Each executeLeafNode runs independently and returns its result to the
 * parent graph via the leafResults reducer channel.
 */
export function buildExecutionGraph(config: ExecutionGraphConfig) {
  const scheduleBatchesNode = makeScheduleBatchesNode(config.scheduleDeps);
  const executeLeafNode = makeExecuteLeafNode(config.leafDeps);
  const integrateCompositeNode = makeIntegrateCompositeNode(config.integrateDeps);
  const runValidationNode = makeRunValidationNode(config.validationDeps);

  const checkpointer = config.checkpointer ?? new MemorySaver();

  const graph = new StateGraph(RunStateAnnotation)
    .addNode("scheduleBatches", scheduleBatchesNode)
    // executeBatch dispatches Send() for each leaf task
    .addNode("executeBatch", executeBatchNode)
    // executeLeafNode runs as a parallel sub-task per Send
    .addNode("executeLeafNode", async (input: LeafExecutionInput) => executeLeafNode(input))
    .addNode("integrateComposite", integrateCompositeNode)
    .addNode("runValidation", runValidationNode)
    // Routing
    .addEdge(START, "scheduleBatches")
    .addEdge("scheduleBatches", "executeBatch")
    // After all parallel leaf tasks complete → integrate
    .addConditionalEdges("executeBatch", (state) => {
      const allBatchesDone = state.currentBatchIndex >= state.batches.length;
      if (allBatchesDone) {
        return "integrateComposite";
      }
      return "executeBatch";
    })
    // executeLeafNode results fan back in via the reducer; then advance batch
    .addEdge("executeLeafNode", "executeBatch")
    .addEdge("integrateComposite", "runValidation")
    .addEdge("runValidation", END);

  return graph.compile({ checkpointer, interruptBefore: [] });
}
