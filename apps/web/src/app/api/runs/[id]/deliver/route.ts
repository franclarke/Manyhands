import { NextResponse } from "next/server";
import { z } from "zod";

import {
  RunLifecycleError,
  RunNotFoundError,
  assertRunActionAllowed,
  getRunRepository,
  isRunnerActive
} from "@/lib/server/runs";
import {
  DeliveryError,
  cleanupRunArtifacts,
  discardRunBranch,
  getDeliveryStatus,
  mergeRunBranch
} from "@/lib/server/runs/delivery";
import { revealInFileExplorer } from "@/lib/server/local-fs";
import { getWorkspaceRepository } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const run = await getRunRepository().get(id);
    return NextResponse.json(await getDeliveryStatus(run));
  } catch (error) {
    return errorResponse(error);
  }
}

const ActionSchema = z.object({
  action: z.enum(["merge", "discard", "cleanup", "reveal"])
});

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const parsed = ActionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "action must be one of: merge, discard, cleanup, reveal" }, { status: 400 });
  }

  try {
    const run = await getRunRepository().get(id);

    // Destructive delivery (merge/discard/cleanup) must not run while the run is
    // not terminal or while a runner still drives it — otherwise it can clobber
    // an in-flight integration or delete a resumable run's worktrees/branches.
    // `reveal` is read-only and stays ungated.
    if (parsed.data.action !== "reveal") {
      assertRunActionAllowed(run, "deliver");
      if (isRunnerActive(id)) {
        throw new RunLifecycleError(
          "El run tiene un runner activo en ejecución; no se puede entregar hasta que termine."
        );
      }
    }

    switch (parsed.data.action) {
      case "merge": {
        const result = await mergeRunBranch(run);
        return NextResponse.json({ ok: true, mergedInto: result.mergedInto });
      }
      case "discard": {
        await discardRunBranch(run);
        return NextResponse.json({ ok: true });
      }
      case "cleanup": {
        const result = await cleanupRunArtifacts(run);
        return NextResponse.json({ ok: true, ...result });
      }
      case "reveal": {
        const target = run.appliedToRepoPath ?? (await workspaceRepoPath(run.workspaceId));
        if (target === undefined) {
          return NextResponse.json({ error: "Este run no tiene una carpeta local para abrir." }, { status: 400 });
        }
        await revealInFileExplorer(target);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}

async function workspaceRepoPath(workspaceId: string): Promise<string | undefined> {
  try {
    const workspace = await getWorkspaceRepository().get(workspaceId);
    return workspace.repoPath;
  } catch {
    return undefined;
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RunLifecycleError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof DeliveryError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
