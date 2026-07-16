import { NextResponse } from "next/server";
import { z } from "zod";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  reviewNode
} from "@/lib/server/runs";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

const ReviewRequestSchema = z
  .object({
    action: z.enum(["approve", "request_changes", "rerun"]),
    feedback: z.string().trim().max(4000).optional()
  })
  .strict();

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, taskId } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  try {
    const parsed = ReviewRequestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new RunValidationError(parsed.error.issues[0]?.message ?? "Invalid review request");
    }
    const saved = await reviewNode(id, taskId, parsed.data.action, parsed.data.feedback);
    return NextResponse.json(await toCanonicalRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof RunValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof RunLifecycleError) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
