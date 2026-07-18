import { NextResponse } from "next/server";
import { z } from "zod";

import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { pauseRunV2 } from "@/lib/server/runs/v2/command-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const parsed = z.object({ reason: z.string().min(1).optional() }).strict().parse(await request.json().catch(() => ({})));
    const result = await pauseRunV2(id, parsed.reason ?? "Paused by operator");
    return NextResponse.json({ ...(await toCanonicalRunResponse(result.run)), pause: { allProcessesDead: result.allProcessesDead } });
  } catch (error) {
    return runErrorResponse(error);
  }
}
