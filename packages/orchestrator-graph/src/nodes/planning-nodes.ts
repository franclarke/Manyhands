/**
 * Planning nodes for the ManyHands LangGraph orchestrator.
 *
 * These nodes handle the recursive decomposition phase:
 *   - initializePlanningNode: seeds the planning queue from the root prompt
 *   - decomposeNode: wraps GeminiRecursiveDecomposer, interrupts on questions
 *   - criticNode: runs plan/seam critics, interrupts for plan approval
 *
 * Design: docs/design/langgraph-orchestrator-design.md §4
 * Invariants: D3 (no silent LLM fallback), D4 (Gemini CLI only)
 */
import { interrupt } from "@langchain/langgraph";
import type { RunState, RunStateUpdate } from "../state.js";

// ─── initializePlanningNode ────────────────────────────────────────────────

/**
 * Seeds the planning queue with the root task ID (or a synthetic root) so
 * decomposeNode has a starting point. Called once when the run transitions
 * from "created" to "planning".
 */
export function initializePlanningNode(state: RunState): RunStateUpdate {
  return {
    status: "planning",
    planningQueue: ["__root__"],
    planningStepCache: {}
  };
}

// ─── decomposeNode ─────────────────────────────────────────────────────────

export interface DecomposeNodeDeps {
  /**
   * Decompose a single task node.
   * Returns either a "decompose" decision (with children) or a "question"
   * decision (requesting human clarification).
   */
  decomposeTask: (params: {
    nodeId: string;
    userPrompt: string;
    workspaceId: string;
    repoPath: string;
    stepCache: Record<string, unknown>;
    planningQueue: string[];
  }) => Promise<DecomposeTaskResult>;
}

export type DecomposeTaskResult =
  | {
      decision: "decompose";
      childIds: string[];
      updatedCache: Record<string, unknown>;
      updatedQueue: string[];
      graphPatch: unknown;
    }
  | {
      decision: "question";
      nodeId: string;
      question: string;
      options: string[];
    };

/**
 * Iterates the planning queue. For each node:
 * - "decompose" → appends children to queue and updates graph
 * - "question"  → writes pending question and calls interrupt() for HITL
 *
 * Completes when the planning queue is empty.
 * Invariant D3: if decomposer fails with LLM error, node re-throws (run fails).
 */
export function makeDecomposeNode(deps: DecomposeNodeDeps) {
  return async function decomposeNode(state: RunState): Promise<RunStateUpdate> {
    // If there's a pending question awaiting a user answer, resume decomposition
    // using the stored answer from userAnswers.
    if (state.pendingQuestion !== null && state.pendingQuestion !== undefined) {
      const { nodeId } = state.pendingQuestion;
      const answer = state.userAnswers[nodeId];
      if (answer === undefined) {
        // Still awaiting answer — interrupt again
        interrupt({
          type: "planning_question",
          nodeId,
          question: state.pendingQuestion.question,
          options: state.pendingQuestion.options
        });
        return {};
      }
      // Answer received — clear pendingQuestion and continue decomposing
      return {
        pendingQuestion: null,
        planningStepCache: {
          ...state.planningStepCache,
          [`answer:${nodeId}`]: answer
        }
      };
    }

    // No pending question — process the next node in the queue
    const queue = [...state.planningQueue];
    if (queue.length === 0) {
      // Planning complete
      return { planningQueue: [] };
    }

    const [nodeId, ...remainingQueue] = queue;
    if (nodeId === undefined) {
      return { planningQueue: remainingQueue };
    }

    const result = await deps.decomposeTask({
      nodeId,
      userPrompt: state.userPrompt,
      workspaceId: state.workspaceId,
      repoPath: state.repoPath,
      stepCache: state.planningStepCache,
      planningQueue: remainingQueue
    });

    if (result.decision === "question") {
      // HITL: suspend the graph and wait for user input
      const { nodeId: qNodeId, question, options } = result;

      // Write question to state before interrupting so the frontend can read it
      const update: RunStateUpdate = {
        pendingQuestion: { nodeId: qNodeId, question, options },
        planningQueue: queue // Keep current queue intact for resume
      };

      // Interrupt suspends execution — frontend calls /resume with the answer
      interrupt({
        type: "planning_question",
        nodeId: qNodeId,
        question,
        options
      });

      return update;
    }

    // "decompose" decision — update queue and graph state
    return {
      planningQueue: result.updatedQueue,
      planningStepCache: result.updatedCache,
      taskGraph: result.graphPatch as any
    };
  };
}

// ─── criticNode ────────────────────────────────────────────────────────────

export interface CriticNodeDeps {
  runPlanCritic: (params: { graph: NonNullable<RunState["taskGraph"]> }) => Promise<CriticResult>;
  runSeamCritic: (params: { graph: NonNullable<RunState["taskGraph"]> }) => Promise<CriticResult>;
}

export interface CriticResult {
  status: "clean" | "warnings" | "errors";
  findings: Array<{ severity: string; message: string; code?: string }>;
}

/**
 * Runs deterministic quality critics against the completed plan.
 * After critics finish, interrupts for human plan approval.
 * The frontend shows critic findings alongside the DAG for the user to review.
 */
export function makeCriticNode(deps: CriticNodeDeps) {
  return async function criticNode(state: RunState): Promise<RunStateUpdate> {
    if (state.taskGraph === null) {
      throw new Error("criticNode: taskGraph is null — planningQueue should have produced a graph");
    }

    const [planCritic, seamCritic] = await Promise.all([
      deps.runPlanCritic({ graph: state.taskGraph }),
      deps.runSeamCritic({ graph: state.taskGraph })
    ]);

    const allFindings = [
      ...planCritic.findings.map((f) => ({ ...f, source: "plan" as const })),
      ...seamCritic.findings.map((f) => ({ ...f, source: "seam" as const }))
    ];

    // HITL: interrupt for plan approval. The frontend renders the DAG + findings
    // and the user clicks "Approve" or makes changes.
    interrupt({
      type: "plan_approval",
      planCritic: { status: planCritic.status, findings: allFindings.filter((f) => f.source === "plan") },
      seamCritic: { status: seamCritic.status, findings: allFindings.filter((f) => f.source === "seam") },
      totalFindings: allFindings.length,
      errorCount: allFindings.filter((f) => f.severity === "error").length
    });

    // Control returns here after user approves
    return {
      status: "approved"
    };
  };
}
