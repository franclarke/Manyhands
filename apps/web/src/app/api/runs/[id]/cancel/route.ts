import { NextResponse } from "next/server";

import { submitProductRunCommand } from "@/lib/server/daemon/productive-client";
import { daemonMutationErrorResponse } from "@/lib/server/daemon/route-errors";
import { toProductRunResponse } from "@/lib/server/runs/product-presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { projection } = await submitProductRunCommand({
      request,
      runId: (await context.params).id,
      command: { type: "cancel_run", reason: "Cancelled by operator" }
    });
    const terminal = projection.lifecycle === "interrupted";
    return NextResponse.json({
      ...toProductRunResponse(projection),
      cancellation: { allProcessesDead: terminal, terminal }
    }, { status: terminal ? 200 : 202 });
  } catch (error) {
    return daemonMutationErrorResponse(error);
  }
}
