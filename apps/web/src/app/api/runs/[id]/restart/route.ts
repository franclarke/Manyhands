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
      command: { type: "restart_run", reason: "Restarted by operator" }
    });
    return NextResponse.json(toProductRunResponse(projection));
  } catch (error) {
    return daemonMutationErrorResponse(error);
  }
}
