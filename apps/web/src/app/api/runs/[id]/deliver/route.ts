import { NextResponse } from "next/server";
import { DeliveryApprovalSchema } from "@manyhands/run-coordinator";

import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { deliverRunV2, loadRunProjectionV2 } from "@/lib/server/runs/v2/command-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const state = await loadRunProjectionV2(id);
    return NextResponse.json({ available: state.lifecycle === "result_ready", lifecycle: state.lifecycle, candidate: state.finalCandidate ?? null, receipt: state.deliveryReceipt ?? null });
  } catch (error) {
    return runErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const approval = DeliveryApprovalSchema.parse(await request.json());
    const result = await deliverRunV2(id, approval);
    return NextResponse.json({ ...(await toCanonicalRunResponse(result.run)), receipt: result.state.deliveryReceipt });
  } catch (error) {
    return runErrorResponse(error);
  }
}
