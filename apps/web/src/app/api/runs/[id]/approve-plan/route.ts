import { NextResponse } from "next/server";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { processPlanApproval } from "@/lib/server/runs/plan-approval-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const { acknowledge, expectedVersion } = await readBody(request);

  try {
    const saved = await processPlanApproval(id, acknowledge, expectedVersion);
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return runErrorResponse(error);
  }
}

async function readBody(request: Request): Promise<{ acknowledge: boolean; expectedVersion?: number }> {
  try {
    const body = (await request.json()) as { acknowledgeCriticErrors?: unknown; expectedVersion?: unknown };
    return {
      acknowledge: body.acknowledgeCriticErrors === true,
      ...(typeof body.expectedVersion === "number" ? { expectedVersion: body.expectedVersion } : {})
    };
  } catch {
    return { acknowledge: false };
  }
}
