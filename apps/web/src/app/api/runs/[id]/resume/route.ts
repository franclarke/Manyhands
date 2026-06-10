import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTransition,
  getRunRepository,
  runPlanningPipeline,
  runExecutionPipeline
} from "@/lib/server/runs";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { toRunResponse } from "@/lib/server/runs/presenter";

import { RunStateAnnotation, JsonFileCheckpointSaver } from "@manyhands/orchestrator-graph";
import { StateGraph, Command } from "@langchain/langgraph";
import { join } from "node:path";
import { resolveRunsDirectory } from "@/lib/server/runs/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const payload = await _request.json().catch(() => null);
    const repo = getRunRepository();
    const run = await repo.get(id);

    // If payload is present, this is a LangGraph interrupt resumption
    if (payload !== null && Object.keys(payload).length > 0) {
      const runsDirectory = resolveRunsDirectory();
      const checkpointsDirectory = join(runsDirectory, "checkpoints");
      const checkpointer = new JsonFileCheckpointSaver(checkpointsDirectory);
      const config = { configurable: { thread_id: id } };
      
      const tuple = await checkpointer.getTuple(config);
      const nodeId = run.pendingQuestion?.nodeId ?? "__root__";
      const answerVal = payload.answer || payload.choice || "";
      
      if (tuple !== undefined) {
        const checkpoint = tuple.checkpoint;
        // Merge userAnswers and clear pendingQuestion
        checkpoint.channel_values.userAnswers = {
          ...(checkpoint.channel_values.userAnswers as Record<string, string> || {}),
          [nodeId]: answerVal
        };
        checkpoint.channel_values.pendingQuestion = null;
        
        await checkpointer.put(config, checkpoint, tuple.metadata ?? { source: "update", step: 0, parents: {} }, {});
      }
      
      // Update RunRecord in DB
      const target = run.pausedDuring === "generating" ? "generating" as const : "running" as const;
      const next = {
        ...run,
        status: target,
        questionAnswers: { ...(run.questionAnswers ?? {}), [nodeId]: answerVal }
      };
      delete next.pausedDuring;
      delete next.pendingQuestion;
      const saved = await repo.save(next);
      publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: new Date().toISOString() });
      
      // Trigger pipeline in background
      if (target === "generating") {
        void runPlanningPipeline(id).catch(e => console.error("[LangGraph] Resume planning failed:", e));
      } else {
        void runExecutionPipeline(id).catch(e => console.error("[LangGraph] Resume execution failed:", e));
      }
      
      return NextResponse.json(toRunResponse(saved));
    }


    // Legacy pause/resume path (no payload)
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

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof RunValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof RunLifecycleError) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
