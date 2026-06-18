import { NextResponse } from "next/server";
import { z } from "zod";
import { RunValidationError, claimRunMutation, resumePlanningPipeline } from "@/lib/server/runs";
import { answerExecutionGate } from "@/lib/server/runs/execution-gate-service";
import { appendRunStatusChanged } from "@/lib/server/runs/run-status-events";
import { planningResumeFor } from "@/lib/server/runs/planning-host";
import { resumeReplanWithAnswer } from "@/lib/server/runs/replan-service";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { getRunRepository } from "@/lib/server/runs/store";
import { startRunBackgroundTask } from "@/lib/server/runs/runner-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const AnswerRequestSchema = z.object({
  nodeId: z.string().min(1),
  answer: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().optional()
}).strict();

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    const text = await request.text();
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  try {
    const parsed = AnswerRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunValidationError(issue?.message ?? "Invalid answer request");
    }
    const { nodeId, answer, expectedVersion } = parsed.data;

    // Replan clarifying question (U2): the run is paused during "running" with
    // a resumable replan context — the answer re-enters the replan.
    const current = await getRunRepository().get(id);
    if (current.status === "paused" && current.pausedDuring === "running" && current.pendingReplan !== undefined) {
      const saved = await resumeReplanWithAnswer(id, nodeId, answer);
      return NextResponse.json(toRunResponse(saved));
    }

    // Execution gate: the chat composer must accept the same answers as the
    // gate's decision card (shared service), instead of 409ing because the
    // planning claim below only matches pauses during "generating".
    if (current.status === "paused" && current.pausedDuring === "running" && current.pendingDecision !== undefined) {
      if (nodeId !== current.pendingDecision.taskId) {
        throw new RunValidationError(
          `Node "${nodeId}" does not match the pending execution gate (task "${current.pendingDecision.taskId}").`
        );
      }
      const gateResult = await answerExecutionGate(current, answer, new Date().toISOString());
      return NextResponse.json(toRunResponse(gateResult.run));
    }

    // Atomic claim (INV-4): the pending question must still match `nodeId`
    // inside the write lock, and the mutator consumes it — a duplicate answer
    // (double-click, second tab) gets a deterministic 409.
    const saved = await claimRunMutation(
      id,
      {
        status: ["paused"],
        pausedDuring: "generating",
        pendingQuestionNodeId: nodeId,
        ...(expectedVersion !== undefined ? { version: expectedVersion } : {})
      },
      (current) => {
        const next = {
          ...current,
          status: "generating" as const,
          questionAnswers: { ...(current.questionAnswers ?? {}), [nodeId]: answer }
        } as typeof current;
        delete next.pausedDuring;
        delete next.pendingQuestion;
        return next;
      }
    );
    await appendRunStatusChanged(saved, { actor: "human" });

    // Native resume: the answer travels as Command({ resume }) into the
    // suspended planning gate (the degraded-plan gate takes a typed action).
    startRunBackgroundTask(saved.runId, "route:answer:planning-question", () =>
      resumePlanningPipeline(saved.runId, planningResumeFor(nodeId, answer))
    );

    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return runErrorResponse(error);
  }
}
