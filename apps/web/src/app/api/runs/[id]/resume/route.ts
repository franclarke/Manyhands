/**
 * POST /api/runs/[id]/resume — resume a paused run.
 *
 * Three resumption modes:
 *  1. Execution gate (LangGraph HITL): the run is paused on a leaf/conflict
 *     gate. The decision is delivered NATIVELY via Command({ resume }) through
 *     resumeExecutionPipeline — checkpoints are never edited by hand.
 *     Accepted payloads: { action: "retry_repair" | "accept_failing" |
 *     "accept_conflict" | "abort_run" } or { answer: <gate option label> }.
 *  2. Planning question: stores the answer and re-runs the planning pipeline
 *     (the decomposer resumes from its step cache).
 *  3. Plain un-pause (no payload): flips paused → generating/running for the
 *     cooperative engine pause.
 */
import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTransition,
  getRunRepository,
  resumePlanningPipeline,
  resumeExecutionPipeline
} from "@/lib/server/runs";
import {
  clearExecutionPause,
  decisionFromAnswer,
  isResumeDecision
} from "@/lib/server/runs/execution-host";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const repo = getRunRepository();
    const run = await repo.get(id);

    // 1) Execution gate resume — native Command({ resume }).
    if (run.status === "paused" && run.pausedDuring === "running" && run.pendingDecision !== undefined) {
      const decision = executionDecisionFrom(payload, run.pendingDecision.gate);
      if (decision === null) {
        throw new RunValidationError(
          "Execution resume requires { action: retry_repair | accept_failing | accept_conflict | abort_run }."
        );
      }
      const saved = await clearExecutionPause(id, "running");
      void resumeExecutionPipeline(id, decision).catch((error) =>
        console.error(`[Resume] Execution resume failed for run ${id}:`, error)
      );
      return NextResponse.json(toRunResponse(saved));
    }

    // 2) Planning question resume.
    const answer = planningAnswerFrom(payload, run.pendingQuestion?.nodeId);
    if (answer !== null) {
      if (run.status !== "paused" || run.pausedDuring !== "generating" || run.pendingQuestion === undefined) {
        throw new RunLifecycleError("Run is not waiting for a planning answer.");
      }
      const nodeId = run.pendingQuestion.nodeId;
      const next = {
        ...run,
        status: "generating" as const,
        questionAnswers: { ...(run.questionAnswers ?? {}), [nodeId]: answer }
      };
      delete next.pausedDuring;
      delete next.pendingQuestion;
      const saved = await repo.save(next);
      publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: new Date().toISOString() });
      // Native resume: the answer travels as Command({ resume }) into the
      // suspended planning questionGate (legacy runs without a planning
      // checkpoint fall back to re-running the pipeline).
      void resumePlanningPipeline(id, { answer }).catch((error) =>
        console.error(`[Resume] Planning resume failed for run ${id}:`, error)
      );
      return NextResponse.json(toRunResponse(saved));
    }

    // 3) Plain un-pause (cooperative engine pause).
    if (run.status !== "paused" || run.pausedDuring === undefined) {
      throw new RunLifecycleError(`Cannot resume from status ${run.status}`);
    }
    const target = run.pausedDuring === "generating" ? "generating" : "running";
    assertTransition(run.status, target);
    const now = new Date().toISOString();
    const next = { ...run, status: target } as typeof run;
    delete next.pausedDuring;
    const saved = await repo.save(next);
    publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: now });
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
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

function planningAnswerFrom(payload: Record<string, unknown> | null, nodeId: string | undefined): string | null {
  if (payload === null) return null;
  if (typeof payload.answer === "string" && payload.answer.length > 0) return payload.answer;
  if (typeof payload.choice === "string" && payload.choice.length > 0) return payload.choice;
  const userAnswers = payload.userAnswers;
  if (nodeId !== undefined && typeof userAnswers === "object" && userAnswers !== null) {
    const candidate = (userAnswers as Record<string, unknown>)[nodeId];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof RunValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof RunLifecycleError) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
