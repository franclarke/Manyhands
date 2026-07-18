import { NextResponse } from "next/server";
import { z } from "zod";

import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { resumeRunV2 } from "@/lib/server/runs/v2/command-host";
import { startExecutionV2Pipeline } from "@/lib/server/runs/v2/execution-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const parsed = z.object({ reason: z.string().min(1).optional() }).strict().parse(await request.json().catch(() => ({})));
    await resumeRunV2(id, parsed.reason ?? "Resumed by operator");
    const run = await startExecutionV2Pipeline(id, "route:resume:execution-v2");
    return NextResponse.json(await toCanonicalRunResponse(run));
  } catch (error) {
    return runErrorResponse(error);
  }
}
