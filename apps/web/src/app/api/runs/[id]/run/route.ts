import { NextResponse } from "next/server";
import {
  getRunRepository
} from "@/lib/server/runs";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { startExecutionV2Pipeline } from "@/lib/server/runs/v2/execution-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const run = await getRunRepository().get(id);
    const started = await startExecutionV2Pipeline(run.runId, "route:run:execution-v2");
    return NextResponse.json(await toCanonicalRunResponse(started));
  } catch (error) {
    return runErrorResponse(error);
  }
}
