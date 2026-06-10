/**
 * Planning nodes for the ManyHands LangGraph orchestrator (v2).
 *
 * Pattern (mirrors the execution graph): the expensive node (decomposePlan)
 * NEVER interrupts — it returns data. HITL lives in cheap, pure gate nodes
 * whose first statement is interrupt(), so resuming re-runs only the gate:
 *
 *   decomposePlan  — drives the recursive decomposer (resumable via its step
 *                    cache); a clarifying question comes back as data.
 *   questionGate   — interrupt({type:"planning_question"}); the resume value
 *                    is the user's answer, merged into userAnswers.
 *   criticReview   — deterministic plan/seam critics over the finished graph.
 *   approvalGate   — interrupt({type:"plan_approval"}); approve → "approved".
 */
import { interrupt } from "@langchain/langgraph";
import type { TaskGraph } from "@manyhands/task-graph";
import type { RunState, RunStateUpdate } from "../state.js";

// ─── Interrupt payloads and resume decisions ───────────────────────────────

export interface PlanningQuestionInterrupt {
  type: "planning_question";
  runId: string;
  nodeId: string;
  question: string;
  options: string[];
}

export interface PlanApprovalInterrupt {
  type: "plan_approval";
  runId: string;
  critique: PlanCritique | null;
}

export type PlanningResumeDecision = { answer: string } | { action: "approve" | "reject" };

// ─── Critique model ────────────────────────────────────────────────────────

export interface PlanCritiqueFinding {
  severity: string;
  message: string;
  source: "plan" | "seam";
  code?: string;
}

export interface PlanCritique {
  findings: PlanCritiqueFinding[];
  errorCount: number;
}

// ─── Dependencies ──────────────────────────────────────────────────────────

export interface DecomposePlanInput {
  runId: string;
  userPrompt: string;
  workspaceId: string;
  repoPath: string;
  /** Opaque resumable state of the recursive decomposer. */
  stepCache: Record<string, unknown>;
  /** Answers the human has given to clarifying questions, keyed by node id. */
  userAnswers: Record<string, string>;
}

export type DecomposePlanResult =
  | { kind: "complete"; graph: TaskGraph }
  | {
      kind: "question";
      nodeId: string;
      question: string;
      options: string[];
      stepCache: Record<string, unknown>;
    };

export interface PlanningGraphDeps {
  /**
   * Run the decomposer until it either finishes the whole tree or needs a
   * human answer. Must be total: LLM/provider failures throw (D3 — the run
   * fails loudly), but a clarifying question is DATA, not an exception.
   */
  decomposePlan(input: DecomposePlanInput): Promise<DecomposePlanResult>;
  /** Deterministic plan/seam critics over the completed graph. */
  runCritics(input: { runId: string; graph: TaskGraph }): Promise<PlanCritique>;
}

// ─── decomposePlan ─────────────────────────────────────────────────────────

export function makeDecomposePlanNode(deps: PlanningGraphDeps) {
  return async function decomposePlan(state: RunState): Promise<RunStateUpdate> {
    const result = await deps.decomposePlan({
      runId: state.runId,
      userPrompt: state.userPrompt,
      workspaceId: state.workspaceId,
      repoPath: state.repoPath,
      stepCache: state.planningStepCache ?? {},
      userAnswers: state.userAnswers ?? {}
    });

    if (result.kind === "question") {
      return {
        status: "planning",
        pendingQuestion: {
          nodeId: result.nodeId,
          question: result.question,
          options: result.options
        },
        planningStepCache: result.stepCache
      };
    }

    return {
      status: "planning",
      taskGraph: result.graph,
      pendingQuestion: null
    };
  };
}

/** Conditional edge after decomposePlan: question pending → gate, else critics. */
export function routeAfterDecompose(state: RunState): "questionGate" | "criticReview" {
  return state.pendingQuestion !== null && state.pendingQuestion !== undefined
    ? "questionGate"
    : "criticReview";
}

// ─── questionGate ──────────────────────────────────────────────────────────

/**
 * Pure HITL gate for decomposer questions. interrupt() is the first statement,
 * so resuming re-runs only this function — never the decomposer itself.
 */
export function questionGateNode(state: RunState): RunStateUpdate {
  const pending = state.pendingQuestion;
  if (pending === null || pending === undefined) {
    return {};
  }

  const decision = interrupt({
    type: "planning_question",
    runId: state.runId,
    nodeId: pending.nodeId,
    question: pending.question,
    options: pending.options
  } satisfies PlanningQuestionInterrupt) as PlanningResumeDecision;

  if (!("answer" in decision) || typeof decision.answer !== "string" || decision.answer.length === 0) {
    throw new Error('questionGate: resume value must be { answer: "<user answer>" }.');
  }

  return {
    pendingQuestion: null,
    userAnswers: { [pending.nodeId]: decision.answer }
  };
}

// ─── criticReview ──────────────────────────────────────────────────────────

export function makeCriticReviewNode(deps: PlanningGraphDeps) {
  return async function criticReview(state: RunState): Promise<RunStateUpdate> {
    if (state.taskGraph === null) {
      throw new Error("criticReview: planning finished without a task graph.");
    }
    const critique = await deps.runCritics({ runId: state.runId, graph: state.taskGraph });
    return { planCritique: critique };
  };
}

// ─── approvalGate ──────────────────────────────────────────────────────────

/**
 * Pure HITL gate for plan approval. The resume value decides the terminal
 * planning status: approve → "approved" (execution may start), reject →
 * "needs_review" (the human keeps editing / restarts planning).
 */
export function approvalGateNode(state: RunState): RunStateUpdate {
  const decision = interrupt({
    type: "plan_approval",
    runId: state.runId,
    critique: state.planCritique ?? null
  } satisfies PlanApprovalInterrupt) as PlanningResumeDecision;

  if ("action" in decision && decision.action === "approve") {
    return { status: "approved" };
  }
  return { status: "needs_review" };
}
