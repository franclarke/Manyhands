import { NextResponse } from "next/server";
import {
  appendStatusEventOrRollback,
  assertRunActionAllowed,
  claimRunMutation,
  requireCapturedRunRecord,
  runExecutionPipeline,
  type RunRecord
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { assertExecutableRunGraph, resolveExecutionGraph } from "@/lib/server/runs/execution-state";
import { startRunBackgroundTask } from "@/lib/server/runs/runner-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    let previous: RunRecord | undefined;
    const saved = await claimRunMutation(
      id,
      { status: ["approved"], rejectActiveRunner: true },
      (current) => {
        previous = current;
        assertRunActionAllowed(current, "start");
        assertExecutableRunGraph(resolveExecutionGraph(current));
        return {
          ...current,
          status: "running" as const,
          startedAt: current.startedAt ?? new Date().toISOString()
        };
      }
    );
    await appendStatusEventOrRollback(requireCapturedRunRecord(previous, id), saved);
    startRunBackgroundTask(saved.runId, "route:run:execution", () => runExecutionPipeline(saved.runId));
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return runErrorResponse(error);
  }
}
