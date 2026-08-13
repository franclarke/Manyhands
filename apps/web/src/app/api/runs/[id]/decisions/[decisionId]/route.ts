import { NextResponse } from "next/server";
import { z } from "zod";

import { submitProductRunCommand } from "@/lib/server/daemon/productive-client";
import { daemonMutationErrorResponse } from "@/lib/server/daemon/route-errors";
import { toProductRunResponse } from "@/lib/server/runs/product-presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DecisionRequestSchema = z.object({
  optionId: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  action: z.string().min(1).optional()
}).strict().refine(
  (value) => value.optionId !== undefined || value.answer !== undefined || value.action !== undefined,
  { message: "A decision requires optionId, answer, or action." }
);

interface RouteContext { params: Promise<{ id: string; decisionId: string }>; }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id, decisionId } = await context.params;
    const body = DecisionRequestSchema.parse(await request.json());
    const optionId = body.optionId ?? body.action;
    const { projection } = await submitProductRunCommand({
      request,
      runId: id,
      command: {
        type: "resolve_decision",
        decisionId,
        ...(optionId === undefined ? {} : { optionId }),
        ...(body.answer === undefined ? {} : { answer: body.answer })
      }
    });
    return NextResponse.json({
      ...toProductRunResponse(projection),
      decisionId,
      ...(optionId === undefined ? {} : { optionId }),
      ...(body.answer === undefined ? {} : { answer: body.answer })
    });
  } catch (error) {
    return daemonMutationErrorResponse(error);
  }
}
