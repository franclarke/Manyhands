import { DeliveryApprovalSchema } from "@manyhands/run-coordinator";
import { NextResponse } from "next/server";

import {
  queryProductRun,
  submitProductRunCommand
} from "@/lib/server/daemon/productive-client";
import {
  daemonMutationErrorResponse,
  daemonQueryErrorResponse
} from "@/lib/server/daemon/route-errors";
import { toProductRunResponse } from "@/lib/server/runs/product-presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const projection = await queryProductRun((await context.params).id);
    return NextResponse.json({
      available: projection.lifecycle === "result_ready",
      lifecycle: projection.lifecycle,
      candidate: projection.finalCandidate ?? null,
      receipt: projection.deliveryReceipt ?? null
    });
  } catch (error) {
    return daemonQueryErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const approval = DeliveryApprovalSchema.parse(await request.json());
    const { projection } = await submitProductRunCommand({
      request,
      runId: (await context.params).id,
      command: { type: "deliver_run", approval }
    });
    return NextResponse.json({
      ...toProductRunResponse(projection),
      receipt: projection.deliveryReceipt
    }, { status: projection.deliveryReceipt === undefined ? 202 : 200 });
  } catch (error) {
    return daemonMutationErrorResponse(error);
  }
}
