import { NextResponse } from "next/server";
import { z } from "zod";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTaskExists,
  buildPatch,
  canonicalPairKey,
  loadEditableRunContext,
  parseRunPatches,
  persistRunPatches
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const AcknowledgeRiskRequestSchema = z.object({
  taskIds: z.tuple([z.string().trim().min(1), z.string().trim().min(1)]),
  reason: z.string().trim().min(1).max(1000).optional()
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
    const parsed = AcknowledgeRiskRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunValidationError(issue?.message ?? "Invalid risk acknowledgement request");
    }

    const [leftTaskId, rightTaskId] = parsed.data.taskIds;
    if (leftTaskId === rightTaskId) {
      throw new RunLifecycleError("Risk acknowledgement requires two distinct tasks");
    }

    const { run, baseSnapshot, currentSnapshot } = await loadEditableRunContext(id);
    assertTaskExists(currentSnapshot, leftTaskId);
    assertTaskExists(currentSnapshot, rightTaskId);

    const pairKey = canonicalPairKey(leftTaskId, rightTaskId);
    const duplicate = parseRunPatches(run.patches).some(
      (patch) => patch.type === "RISK_ACKNOWLEDGED" && canonicalPairKey(patch.taskIds[0], patch.taskIds[1]) === pairKey
    );
    if (duplicate) {
      throw new RunLifecycleError(`Risk ${pairKey} is already acknowledged`);
    }

    const patch = buildPatch("RISK_ACKNOWLEDGED", {
      taskIds: [leftTaskId, rightTaskId],
      reason: parsed.data.reason ?? "Accepted as an explicit coordination risk."
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
