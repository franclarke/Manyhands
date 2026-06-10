import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { processPlanApproval } from "@/lib/server/runs/plan-approval-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const acknowledge = await readAcknowledge(request);

  try {
    const saved = await processPlanApproval(id, acknowledge);
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

async function readAcknowledge(request: Request): Promise<boolean> {
  try {
    const body = (await request.json()) as { acknowledgeCriticErrors?: unknown };
    return body.acknowledgeCriticErrors === true;
  } catch {
    return false;
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
