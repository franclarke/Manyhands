import { NextResponse } from "next/server";
import { z } from "zod";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTaskExists,
  buildPatch,
  loadEditableRunContext,
  persistRunPatches
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const SerializeRequestSchema = z.object({
  fromTaskId: z.string().trim().min(1),
  toTaskId: z.string().trim().min(1),
  rationale: z.string().trim().min(1).max(1000).optional()
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
    const parsed = SerializeRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunValidationError(issue?.message ?? "Invalid serialize request");
    }

    const { run, baseSnapshot, currentSnapshot } = await loadEditableRunContext(id);
    const { fromTaskId, toTaskId, rationale } = parsed.data;
    if (fromTaskId === toTaskId) {
      throw new RunLifecycleError("Serialize cannot create a self-dependency");
    }
    assertTaskExists(currentSnapshot, fromTaskId);
    assertTaskExists(currentSnapshot, toTaskId);

    const duplicate = currentSnapshot.graphSnapshot.dependencies.some(
      (dependency) => dependency.fromTaskId === fromTaskId && dependency.toTaskId === toTaskId
    );
    if (duplicate) {
      throw new RunLifecycleError(`Dependency ${fromTaskId} -> ${toTaskId} already exists`);
    }

    const patch = buildPatch("TASKS_SERIALIZED", {
      fromTaskId,
      toTaskId,
      ...(rationale !== undefined ? { rationale } : {})
    });
    const saved = await persistRunPatches({ run, baseSnapshot, patches: [patch] });
    return NextResponse.json(toRunResponse(saved));
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
