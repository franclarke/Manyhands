/**
 * Execution StateGraph for the ManyHands LangGraph orchestrator.
 *
 * Topology (dynamic wavefront map-reduce, D9):
 *
 *   START → prepare → waveJoin ─[routeFrontier]→ Send(executeLeaf)* | leafGate | integrationJoin
 *   executeLeaf → waveJoin                       (parallel fan-in barrier)
 *   leafGate ─Command→ Send(executeLeaf) | waveJoin | END
 *   integrationJoin ─[routeIntegration]→ integrateNextComposite | conflictGate | runValidation
 *   integrateNextComposite → integrationJoin     (one composite per superstep)
 *   conflictGate ─Command→ integrationJoin | END
 *   runValidation → END
 *
 * Sends are dispatched exclusively from conditional edges; HITL interrupts
 * live exclusively in the pure gate nodes, resumable with Command({ resume }).
 *
 * Design: docs/design/future-frontier-tasks.md §1
 */
import { StateGraph, END, START, MemorySaver } from "@langchain/langgraph";
import { RunStateAnnotation, type RunState } from "../state.js";
import {
  budgetGateNode,
  conflictGateNode,
  integrationJoinNode,
  leafGateNode,
  makeExecuteLeafNode,
  makeIntegrateNextCompositeNode,
  makeRouteFrontier,
  makeRunValidationNode,
  prepareExecutionNode,
  routeIntegration,
  waveJoinNode,
  type ExecuteLeafNodeDeps,
  type FrontierRouterDeps,
  type IntegrateCompositeNodeDeps,
  type LeafExecutionInput,
  type RunValidationNodeDeps
} from "../nodes/execution-nodes.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

export interface ExecutionGraphConfig {
  leafDeps: ExecuteLeafNodeDeps;
  integrateDeps: IntegrateCompositeNodeDeps;
  validationDeps: RunValidationNodeDeps;
  frontierDeps?: FrontierRouterDeps;
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Build the execution graph. Uses MemorySaver by default (tests); production
 * callers inject JsonFileCheckpointSaver so checkpoints survive the process.
 */
export function buildExecutionGraph(config: ExecutionGraphConfig) {
  const executeLeafNode = makeExecuteLeafNode(config.leafDeps);
  const integrateNextCompositeNode = makeIntegrateNextCompositeNode(config.integrateDeps);
  const runValidationNode = makeRunValidationNode(config.validationDeps);
  const routeFrontier = makeRouteFrontier(config.frontierDeps ?? {});

  const checkpointer = config.checkpointer ?? new MemorySaver();

  const graph = new StateGraph(RunStateAnnotation)
    .addNode("prepare", prepareExecutionNode)
    .addNode("waveJoin", waveJoinNode)
    .addNode("executeLeaf", async (input: LeafExecutionInput) => executeLeafNode(input))
    .addNode("leafGate", leafGateNode, { ends: ["executeLeaf", "waveJoin", END] })
    .addNode("budgetGate", budgetGateNode, { ends: ["waveJoin", END] })
    .addNode("integrationJoin", integrationJoinNode)
    .addNode("integrateNextComposite", integrateNextCompositeNode)
    .addNode("conflictGate", conflictGateNode, { ends: ["integrationJoin", END] })
    .addNode("runValidation", runValidationNode)
    .addEdge(START, "prepare")
    .addEdge("prepare", "waveJoin")
    .addConditionalEdges("waveJoin", routeFrontier, ["executeLeaf", "leafGate", "budgetGate", "integrationJoin"])
    .addEdge("executeLeaf", "waveJoin")
    .addConditionalEdges("integrationJoin", routeIntegration, [
      "conflictGate",
      "integrateNextComposite",
      "runValidation"
    ])
    .addEdge("integrateNextComposite", "integrationJoin")
    .addEdge("runValidation", END);

  return graph.compile({ checkpointer });
}

/**
 * Recursion budget for a run: each executable task costs ~2 supersteps
 * (dispatch + join), each composite 2 (integrate + join), plus gates and
 * fixed overhead. Generous headroom avoids spurious GraphRecursionError on
 * deep DAGs without masking real livelock (which no longer exists — the
 * frontier strictly shrinks).
 */
export function executionRecursionLimit(state: Pick<RunState, "taskGraph">): number {
  const nodeCount = state.taskGraph === null ? 0 : Object.keys(state.taskGraph.nodes).length;
  return Math.max(64, nodeCount * 8 + 32);
}
