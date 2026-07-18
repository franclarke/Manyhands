import { NextResponse } from "next/server";

import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { cancelRunV2 } from "@/lib/server/runs/v2/command-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const result = await cancelRunV2(id, "Cancelled by operator");
    return NextResponse.json({
      ...(await toCanonicalRunResponse(result.run)),
      cancellation: {
        processesObserved: result.processCount,
        allProcessesDead: result.allProcessesDead,
        terminal: result.state.lifecycle === "interrupted"
      }
    }, { status: result.state.lifecycle === "interrupted" ? 200 : 202 });
  } catch (error) {
    return runErrorResponse(error);
  }
}
