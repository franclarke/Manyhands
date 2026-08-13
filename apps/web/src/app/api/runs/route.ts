import { ExecutionConfigSchema } from "@manyhands/execution-core";
import type { RunCommandJsonValue } from "@manyhands/run-coordinator";
import { NextResponse } from "next/server";

import {
  commandIdForRequest,
  listProductRuns,
  runIdForCreateCommand,
  submitProductRunCommand
} from "@/lib/server/daemon/productive-client";
import {
  daemonMutationErrorResponse,
  daemonQueryErrorResponse
} from "@/lib/server/daemon/route-errors";
import { assertDeclaredStageSelection } from "@/lib/server/providers/capability-service";
import { defaultStageSelection } from "@/lib/server/runs/executor-selection";
import { toProductRunPreview, toProductRunResponse } from "@/lib/server/runs/product-presenter";
import { RUN_STATUS_VALUES, RunCreateRequestSchema } from "@/lib/server/runs/schema";
import { captureRunTargetContext } from "@/lib/server/runs/target-context";
import {
  getWorkspaceRepository,
  withWorkspaceReferenceLock
} from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const requestedWorkspaceId = url.searchParams.get("workspaceId") ?? undefined;
    const canonicalWorkspaceId = requestedWorkspaceId === undefined
      ? undefined
      : (await getWorkspaceRepository().get(requestedWorkspaceId)).id;
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 50 : Math.max(1, Math.min(50, Number(rawLimit) || 1));
    const allowedStatuses = new Set<string>(RUN_STATUS_VALUES);
    const statuses = (url.searchParams.get("status") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => allowedStatuses.has(entry));
    const runs = await listProductRuns({
      ...(canonicalWorkspaceId === undefined ? {} : { workspaceId: canonicalWorkspaceId }),
      includeArchived: url.searchParams.get("include") === "archived",
      ...(statuses.length === 0 ? {} : { statuses }),
      limit
    });
    const workspaces = await getWorkspaceRepository().indexById();
    return NextResponse.json({ runs: runs.map((run) => toProductRunPreview(run, workspaces)) });
  } catch (error) {
    return daemonQueryErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = RunCreateRequestSchema.parse(await request.json());
    const commandId = commandIdForRequest(request);
    const runId = runIdForCreateCommand(commandId);
    const { projection } = await withWorkspaceReferenceLock(async () => {
      const workspace = await getWorkspaceRepository().get(parsed.workspaceId);
      if (workspace.repoPath === undefined) {
        throw new TypeError("ManyHands requires a workspace with a local Git repository.");
      }
      const planningSelection = assertDeclaredStageSelection(
        "Planning",
        parsed.planningSelection ?? defaultStageSelection(),
        "planning"
      );
      const executionSelection = assertDeclaredStageSelection(
        "Execution",
        parsed.executionSelection ?? planningSelection,
        "execution"
      );
      const repairSelection = assertDeclaredStageSelection(
        "Repair",
        parsed.repairSelection ?? executionSelection,
        "repair"
      );
      const executionConfig = ExecutionConfigSchema.parse(parsed.executionConfig ?? {});
      const createdAt = new Date().toISOString();
      const targetContext = await captureRunTargetContext(workspace.repoPath, createdAt);
      if (targetContext?.physicalIdentity === undefined) {
        throw new TypeError(`Cannot capture the physical identity of Git repository ${workspace.repoPath}.`);
      }
      const durableTargetContext = Object.fromEntries(
        Object.entries(targetContext).filter(([key]) => key !== "capturedAt")
      );
      const definition = {
        schemaVersion: 1 as const,
        workspaceId: workspace.id,
        userPrompt: parsed.userPrompt,
        acceptanceCriteria: parsed.acceptanceCriteria ?? [],
        title: parsed.userPrompt.slice(0, 120),
        planningSelection: jsonStage(planningSelection),
        executionSelection: jsonStage(executionSelection),
        repairSelection: jsonStage(repairSelection),
        executionConfig: JSON.parse(JSON.stringify(executionConfig)) as Record<string, RunCommandJsonValue>,
        ...(parsed.granularityCondition === undefined
          ? {}
          : { granularityCondition: parsed.granularityCondition }),
        targetContext: JSON.parse(JSON.stringify(durableTargetContext)) as Record<string, RunCommandJsonValue>
      };
      return submitProductRunCommand({
        request,
        commandId,
        runId,
        command: { type: "create_run", definition },
        allowMissingRun: true
      });
    });
    return NextResponse.json(toProductRunResponse(projection), { status: 201 });
  } catch (error) {
    return daemonMutationErrorResponse(error);
  }
}

function jsonStage(selection: { executorId: string; model: string; effort?: string }) {
  return {
    executorId: selection.executorId,
    model: selection.model,
    ...(selection.effort === undefined ? {} : { effort: selection.effort })
  };
}
