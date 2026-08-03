import { randomUUID } from "node:crypto";
import { ExecutionConfigSchema } from "@manyhands/execution-core";
import { NextResponse } from "next/server";

import { assertDeclaredStageSelection } from "@/lib/server/providers/capability-service";
import { RunLifecycleError, RunNotFoundError, RunValidationError } from "@/lib/server/runs/errors";
import { defaultStageSelection } from "@/lib/server/runs/executor-selection";
import { toCanonicalRunResponse, toRunPreview } from "@/lib/server/runs/presenter";
import { RUN_STATUS_VALUES, RunCreateRequestSchema, type RunRecord, type RunStatus } from "@/lib/server/runs/schema";
import { getRunRepository } from "@/lib/server/runs/store";
import { captureRunTargetContext } from "@/lib/server/runs/target-context";
import { startRunBackgroundTask } from "@/lib/server/runs/runner-state";
import { runPlanningV2Pipeline } from "@/lib/server/runs/v2/run-coordinator-host";
import { initializeRunCanonicalEvents } from "@/lib/server/runs/v2/initialize-run";
import { resolveRunsDirectory } from "@/lib/server/runs/runs-directory";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  getWorkspaceRepository,
  withWorkspaceReferenceLock
} from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const statusParam = url.searchParams.get("status");
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? undefined : Math.max(1, Math.min(50, Number(limitRaw) || 0));
    const workspaceRepository = getWorkspaceRepository();
    const equivalentWorkspaceIds = workspaceId !== null && workspaceId.length > 0
      ? await workspaceRepository.equivalentIds(workspaceId)
      : undefined;
    const filter: { workspaceIds?: string[]; includeArchived?: boolean; limit?: number } = {
      includeArchived: url.searchParams.get("include") === "archived"
    };
    if (equivalentWorkspaceIds !== undefined) filter.workspaceIds = equivalentWorkspaceIds;
    if (limit !== undefined) filter.limit = limit;
    let runs = await getRunRepository().list(filter);
    const statuses = statusParam === null ? [] : parseStatusFilter(statusParam);
    if (statuses.length > 0) runs = runs.filter((run) => statuses.includes(run.projection.lifecycle));
    // One locked read. Resolving aliases with an `equivalentIds` call per
    // workspace took the workspace file lock once per workspace, and each
    // acquisition costs ~1.3s on a Windows volume: the listing spent ~17s of
    // its ~17.3s here while its own run data read in 6ms.
    const byId = await workspaceRepository.indexById();
    return NextResponse.json({ runs: runs.map((run) => toRunPreview(run, byId)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  try {
    const parsed = RunCreateRequestSchema.safeParse(payload);
    if (!parsed.success) throw new RunValidationError(parsed.error.issues[0]?.message ?? "Invalid run create request");
    const saved = await withWorkspaceReferenceLock(async () => {
      const workspace = await getWorkspaceRepository().get(parsed.data.workspaceId);
      if (workspace.repoPath === undefined) throw new RunValidationError("ManyHands requires a workspace with a local Git repository.");
      const planningSelection = assertDeclaredStageSelection("Planning", parsed.data.planningSelection ?? defaultStageSelection(), "planning");
      const executionSelection = assertDeclaredStageSelection("Execution", parsed.data.executionSelection ?? planningSelection, "execution");
      const repairSelection = assertDeclaredStageSelection("Repair", parsed.data.repairSelection ?? executionSelection, "repair");
      const executionConfig = ExecutionConfigSchema.parse(parsed.data.executionConfig ?? {});
      const now = new Date().toISOString();
      const targetContext = await captureRunTargetContext(workspace.repoPath, now);
      if (targetContext?.physicalIdentity === undefined) {
        throw new RunValidationError(`Cannot capture the physical identity of Git repository ${workspace.repoPath}.`);
      }
      const record: RunRecord = {
        runId: randomUUID(),
        workspaceId: workspace.id,
        userPrompt: parsed.data.userPrompt,
        title: parsed.data.userPrompt.slice(0, 120),
        planningSelection,
        executionSelection,
        repairSelection,
        executionConfig,
        ...(parsed.data.granularityCondition !== undefined
          ? { granularityCondition: parsed.data.granularityCondition }
          : {}),
        ...(parsed.data.planningAcceptanceCriteria !== undefined
          ? { planningAcceptanceCriteria: parsed.data.planningAcceptanceCriteria }
          : {}),
        ...(parsed.data.experimentalCandidate !== undefined
          ? { experimentalCandidate: parsed.data.experimentalCandidate }
          : {}),
        targetContext,
        projection: { eventSequence: 0, lifecycle: "planning", updatedAt: now },
        version: 0,
        createdAt: now,
        updatedAt: now
      };
      return getRunRepository().save(record);
    });
    await initializeRunCanonicalEvents({
      directory: resolveRunsDirectory(),
      runId: saved.runId,
      goal: saved.userPrompt,
      occurredAt: saved.createdAt
    });
    startRunBackgroundTask(saved.runId, "route:create:planning-v2", () => runPlanningV2Pipeline(saved.runId));
    return NextResponse.json(await toCanonicalRunResponse(saved), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function parseStatusFilter(raw: string): RunStatus[] {
  const allowed = new Set<string>(RUN_STATUS_VALUES);
  return raw.split(",").map((entry) => entry.trim()).filter((entry) => allowed.has(entry)) as RunStatus[];
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof WorkspaceNotFoundError || error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof WorkspaceConflictError || error instanceof RunLifecycleError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof RunValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}
