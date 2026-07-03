import { NextResponse } from "next/server";
import {
  appendStatusEventOrRollback,
  assertRunActionAllowed,
  assertTransition,
  claimRunMutation,
  requireCapturedRunRecord,
  type RunRecord
} from "@/lib/server/runs";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const expectedVersion = typeof payload?.expectedVersion === "number" ? payload.expectedVersion : undefined;
    const now = new Date().toISOString();
    let previous: RunRecord | undefined;
    const saved = await claimRunMutation(
      id,
      {
        status: ["generating", "running"],
        ...(expectedVersion !== undefined ? { version: expectedVersion } : {})
      },
      (current) => {
        previous = current;
        assertRunActionAllowed(current, "pause");
        assertTransition(current.status, "paused");
        return {
          ...current,
          status: "paused" as const,
          pausedDuring: current.status === "generating" ? ("generating" as const) : ("running" as const)
        };
      }
    );
    await appendStatusEventOrRollback(requireCapturedRunRecord(previous, id), saved, { at: now, actor: "human" });
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return runErrorResponse(error);
  }
}
