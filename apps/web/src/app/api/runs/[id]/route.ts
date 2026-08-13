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
import { getWorkspaceRepository } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const projection = await queryProductRun((await context.params).id);
    return NextResponse.json(await present(projection));
  } catch (error) {
    return daemonQueryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = await request.json() as { title?: unknown };
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      throw new TypeError("A non-empty title is required.");
    }
    const { projection } = await submitProductRunCommand({
      request,
      runId: id,
      command: { type: "rename_run", title: body.title.trim().slice(0, 120) }
    });
    return NextResponse.json(await present(projection));
  } catch (error) {
    return daemonMutationErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    await submitProductRunCommand({ request, runId: id, command: { type: "archive_run" } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return daemonMutationErrorResponse(error);
  }
}

async function present(projection: Awaited<ReturnType<typeof queryProductRun>>) {
  const workspaceId = projection.definition?.workspaceId;
  if (workspaceId === undefined) return toProductRunResponse(projection);
  const canonical = await getWorkspaceRepository().get(workspaceId).catch(() => undefined);
  return toProductRunResponse(projection, canonical?.id ?? workspaceId);
}
