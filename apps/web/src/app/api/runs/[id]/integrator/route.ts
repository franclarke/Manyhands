import { NextResponse } from "next/server";
import { z } from "zod";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
} from "@/lib/server/runs";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { createIntegratorTask } from "@/lib/server/runs/integrator-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const IntegratorRequestSchema = z.object({
  taskIds: z.array(z.string().trim().min(1)).min(2),
  reason: z.string().trim().min(1).max(1000),
  title: z.string().trim().min(1).max(160).optional()
}).strict();

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  try {
    const parsed = IntegratorRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunValidationError(issue?.message ?? "Invalid integrator request");
    }

    const taskIds = [...new Set(parsed.data.taskIds)];
    if (taskIds.length !== parsed.data.taskIds.length) {
      throw new RunValidationError("Integrator taskIds must be unique");
    }

    const saved = await createIntegratorTask({
      id,
      taskIds,
      reason: parsed.data.reason,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {})
    });
    
    return NextResponse.json(await toCanonicalRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RunValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof RunLifecycleError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
