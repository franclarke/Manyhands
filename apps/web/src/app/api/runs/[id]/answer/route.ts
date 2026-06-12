import { NextResponse } from "next/server";
import { z } from "zod";
import { RunValidationError, claimRunMutation, resumePlanningPipeline } from "@/lib/server/runs";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { planningResumeFor } from "@/lib/server/runs/planning-host";
import { resumeReplanWithAnswer } from "@/lib/server/runs/replan-service";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { getRunRepository } from "@/lib/server/runs/store";

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
    publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: new Date().toISOString() });

    // Native resume: the answer travels as Command({ resume }) into the
    // suspended planning gate (the degraded-plan gate takes a typed action).
    void resumePlanningPipeline(saved.runId, planningResumeFor(nodeId, answer)).catch(() => undefined);

    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return runErrorResponse(error);
  }
}
