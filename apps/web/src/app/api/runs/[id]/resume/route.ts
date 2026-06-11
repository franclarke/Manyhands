/**
 * POST /api/runs/[id]/resume — resume a paused run.
 *
 * Three resumption modes:
 *  1. Execution gate (LangGraph HITL): the run is paused on a leaf/conflict
 *     gate. The decision is delivered NATIVELY via Command({ resume }) through
 *     resumeExecutionPipeline — checkpoints are never edited by hand.
 *     Accepted payloads: { action: "retry_repair" | "accept_failing" |
 *     "accept_conflict" | "abort_run" } or { answer: <gate option label> }.
 *  2. Planning question: stores the answer and resumes the planning graph.
 *  3. Plain un-pause (no payload): flips paused → generating/running for the
 *     cooperative engine pause.
 *
 * Every mode claims the run via `claimRunMutation` (INV-4): the expectation is
 * re-checked inside the per-run write lock and the claim consumes the pending
 * gate/question, so a concurrent duplicate request gets a deterministic 409.
 * Clients may pin the exact interruption with { gateId } and guard against
 * stale state with { expectedVersion }.
 */
import { NextResponse } from "next/server";
import {
  RunMutationConflictError,
  RunValidationError,
  claimRunMutation,
  getRunRepository,
  resumePlanningPipeline,
  resumeExecutionPipeline
} from "@/lib/server/runs";
import {
  clearExecutionPause,
  decisionFromAnswer,
  isReplanRequest,
  isResumeDecision
} from "@/lib/server/runs/execution-host";
import { replanSubtree } from "@/lib/server/runs/replan-service";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toRunResponse } from "@/lib/server/runs/presenter";
import type { RunRecord } from "@/lib/server/runs/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const expectedGateId = typeof payload?.gateId === "string" ? payload.gateId : undefined;
    const expectedVersion = typeof payload?.expectedVersion === "number" ? payload.expectedVersion : undefined;
    const run = await getRunRepository().get(id);

    // 1) Execution gate resume — native Command({ resume }).
    if (run.status === "paused" && run.pausedDuring === "running" && run.pendingDecision !== undefined) {
      // Selective re-decomposition: rebuild the failed subtree instead of
      // resuming the suspended gate (the execution thread is reset).
      if (isReplanRequest(payload)) {
        const failedTaskId = run.pendingDecision.taskId;
        const reason = run.pendingDecision.validationOutput ?? "leaf failed irrecoverably";
        const saved = await clearExecutionPause(id, "running", expectedGateId);
        void replanSubtree(id, failedTaskId, reason).catch((error) =>
          console.error(`[Resume] Replan failed for run ${id}:`, error)
        );
        return NextResponse.json(toRunResponse(saved));
      }

      const decision = executionDecisionFrom(payload, run.pendingDecision.gate);
      if (decision === null) {
        throw new RunValidationError(
          "Execution resume requires { action: retry_repair | replan_subtree | accept_failing | accept_conflict | abort_run }."
        );
      }
      const saved = await clearExecutionPause(id, "running", expectedGateId);
      void resumeExecutionPipeline(id, decision).catch((error) =>
        console.error(`[Resume] Execution resume failed for run ${id}:`, error)
      );
      return NextResponse.json(toRunResponse(saved));
    }

    // 2) Planning question resume.
    const planningAnswer = planningAnswerFrom(payload, run.pendingQuestion?.nodeId);
    if (planningAnswer !== null) {
      const saved = await claimRunMutation(
        id,
        {
          status: ["paused"],
          pausedDuring: "generating",
          pendingQuestionNodeId: planningAnswer.nodeId ?? "any",
          ...(expectedVersion !== undefined ? { version: expectedVersion } : {})
        },
        (current) => {
          const nodeId = current.pendingQuestion?.nodeId as string;
          const next = {
            ...current,
            status: "generating" as const,
            questionAnswers: { ...(current.questionAnswers ?? {}), [nodeId]: planningAnswer.answer }
          };
          delete next.pausedDuring;
          delete next.pendingQuestion;
          return next;
        }
      );
      publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: new Date().toISOString() });
      // Native resume: the answer travels as Command({ resume }) into the
      // suspended planning questionGate (legacy runs without a planning
      // checkpoint fall back to re-running the pipeline).
      void resumePlanningPipeline(id, { answer: planningAnswer.answer }).catch((error) =>
        console.error(`[Resume] Planning resume failed for run ${id}:`, error)
      );
      return NextResponse.json(toRunResponse(saved));
    }

    // 3) Plain un-pause (cooperative engine pause).
    const saved = await claimRunMutation(
      id,
      { status: ["paused"], ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
      (current) => {
        if (current.pendingDecision !== undefined || current.pendingQuestion !== undefined) {
          throw new RunMutationConflictError(
            `Run ${id} is suspended on a gate; resuming requires a decision payload.`,
            current.status,
            current.version
          );
        }
        if (current.pausedDuring === undefined) {
          throw new RunMutationConflictError(
            `Run ${id} is paused without a recorded phase; cannot un-pause.`,
            current.status,
            current.version
          );
        }
        const target = current.pausedDuring === "generating" ? ("generating" as const) : ("running" as const);
        const next = { ...current, status: target } as RunRecord;
        delete next.pausedDuring;
        return next;
      }
    );
    publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: new Date().toISOString() });
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return runErrorResponse(error);
  }
}

function executionDecisionFrom(
  payload: Record<string, unknown> | null,
  gate: "leaf_validation_failed" | "merge_conflict"
) {
  if (payload === null) return null;
  if (isResumeDecision(payload)) return payload;
  if (typeof payload.answer === "string") return decisionFromAnswer(gate, payload.answer);
  return null;
}

interface PlanningAnswer {
  answer: string;
  /** Set when the payload addressed a specific question node; pins the claim. */
  nodeId?: string;
}

function planningAnswerFrom(
  payload: Record<string, unknown> | null,
  nodeId: string | undefined
): PlanningAnswer | null {
  if (payload === null) return null;
  if (typeof payload.answer === "string" && payload.answer.length > 0) return { answer: payload.answer };
  if (typeof payload.choice === "string" && payload.choice.length > 0) return { answer: payload.choice };
  const userAnswers = payload.userAnswers;
  if (nodeId !== undefined && typeof userAnswers === "object" && userAnswers !== null) {
    const candidate = (userAnswers as Record<string, unknown>)[nodeId];
    if (typeof candidate === "string" && candidate.length > 0) return { answer: candidate, nodeId };
  }
  return null;
}
