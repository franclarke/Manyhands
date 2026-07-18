import { NextResponse } from "next/server";

import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { restartRunV2 } from "@/lib/server/runs/v2/command-host";
import { startExecutionV2Pipeline } from "@/lib/server/runs/v2/execution-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    await restartRunV2(id, "Restarted by operator");
    const run = await startExecutionV2Pipeline(id, "route:restart:execution-v2");
    return NextResponse.json(await toCanonicalRunResponse(run));
  } catch (error) {
    return runErrorResponse(error);
  }
}
