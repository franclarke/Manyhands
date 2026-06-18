import { NextResponse } from "next/server";
import {
  claimRunMutation,
  runExecutionPipeline
} from "@/lib/server/runs";
import { appendRunStatusChanged } from "@/lib/server/runs/run-status-events";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { startRunBackgroundTask } from "@/lib/server/runs/runner-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const saved = await claimRunMutation(
      id,
      { status: ["approved"], rejectActiveRunner: true },
      (current) => ({
        ...current,
        status: "running" as const,
        startedAt: current.startedAt ?? new Date().toISOString()
      })
    );
    await appendRunStatusChanged(saved);
    startRunBackgroundTask(saved.runId, "route:run:execution", () => runExecutionPipeline(saved.runId));
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return runErrorResponse(error);
  }
}
