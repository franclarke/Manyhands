import { NextResponse } from "next/server";
import { z } from "zod";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  getRunRepository,
  runPlanningPipeline
} from "@/lib/server/runs";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const AnswerRequestSchema = z.object({
  nodeId: z.string().min(1),
  answer: z.string().min(1)
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

    const repo = getRunRepository();
    const run = await repo.get(id);

    if (run.status !== "paused" || run.pausedDuring !== "generating" || !run.pendingQuestion) {
      throw new RunLifecycleError("Run is not currently waiting for a planning question response");
    }

    const { nodeId, answer } = parsed.data;

    if (run.pendingQuestion.nodeId !== nodeId) {
      throw new RunValidationError("Node ID does not match the pending question");
    }

    const updatedAnswers = { ...(run.questionAnswers ?? {}), [nodeId]: answer };
    const nextRun = {
      ...run,
      status: "generating" as const,
      questionAnswers: updatedAnswers
    } as typeof run;
    delete nextRun.pausedDuring;
    delete nextRun.pendingQuestion;

    const saved = await repo.save(nextRun);
    publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: new Date().toISOString() });

    void runPlanningPipeline(saved.runId).catch(() => undefined);

    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
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
