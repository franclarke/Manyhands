import { NextResponse } from "next/server";
import { z } from "zod";

import { submitProductRunCommand } from "@/lib/server/daemon/productive-client";
import { daemonMutationErrorResponse } from "@/lib/server/daemon/route-errors";
import { toProductRunResponse } from "@/lib/server/runs/product-presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const body = z.object({ reason: z.string().min(1).optional() }).strict()
      .parse(await request.json().catch(() => ({})));
    const { projection } = await submitProductRunCommand({
      request,
      runId: (await context.params).id,
      command: { type: "resume_run", reason: body.reason ?? "Resumed by operator" }
    });
    return NextResponse.json(toProductRunResponse(projection));
  } catch (error) {
    return daemonMutationErrorResponse(error);
  }
}
