import { NextResponse } from "next/server";

import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { restartRunV2 } from "@/lib/server/runs/v2/command-host";
import { startExecutionV2Pipeline } from "@/lib/server/runs/v2/execution-pipeline";
import { markRunFailedAfterBackgroundTask } from "@/lib/server/runs/v2/background-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    await restartRunV2(id, "Restarted by operator");
    let run: Awaited<ReturnType<typeof startExecutionV2Pipeline>>;
    try {
      run = await startExecutionV2Pipeline(id, "route:restart:execution-v2");
    } catch (error) {
      await markRunFailedAfterBackgroundTask(id, error, "execution");
      throw error;
    }
    return NextResponse.json(await toCanonicalRunResponse(run));
  } catch (error) {
    return runErrorResponse(error);
  }
}
