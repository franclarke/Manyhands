import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  RunCreateRequestSchema,
  RUN_STATUS_VALUES,
  getRunRepository,
  runPlanningPipeline,
  sweepManyIfStale,
  type RunRecord,
  type RunStatus
} from "@/lib/server/runs";
import { startRunBackgroundTask } from "@/lib/server/runs/runner-state";
import { toRunPreview, toRunResponse } from "@/lib/server/runs/presenter";
import {
  WorkspaceNotFoundError,
  getWorkspaceRepository
} from "@/lib/server/workspaces";
import { CLAUDE_CODE_EXECUTOR_ID, findModelForSelection, type ExecutorSelection } from "@/lib/models";
import { resolveLegacyModelSelection } from "@manyhands/execution-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const statusParam = url.searchParams.get("status");
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? undefined : Math.max(1, Math.min(50, Number(limitRaw) || 0));
    const filter: { workspaceId?: string; limit?: number } = {};
    if (workspaceId !== null && workspaceId.length > 0) filter.workspaceId = workspaceId;
    if (limit !== undefined && limit > 0) filter.limit = limit;
    const [rawRuns, workspaces] = await Promise.all([
      getRunRepository().list(filter),
      getWorkspaceRepository().list()
    ]);
    let runs = await sweepManyIfStale(rawRuns);
    if (statusParam !== null && statusParam.length > 0) {
      const statuses = parseStatusFilter(statusParam);
      if (statuses.length > 0) {
        runs = runs.filter((entry) => statuses.includes(entry.status));
      }
    }
    const wsByid = new Map(workspaces.map((w) => [w.id, w]));
    return NextResponse.json({ runs: runs.map((run) => toRunPreview(run, wsByid)) });
  } catch (error) {
    return errorResponse(error);
  }
}

function parseStatusFilter(raw: string): RunStatus[] {
  const allowed = new Set<string>(RUN_STATUS_VALUES);
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && allowed.has(entry)) as RunStatus[];
}

function validateExecutionSelection(selection: ExecutorSelection | undefined): void {
  if (selection === undefined) {
    return;
  }
  const model = findModelForSelection(selection);
  if (model === undefined || !model.enabled) {
    throw new RunValidationError(`Unsupported executor/model selection "${selection.executorId}/${selection.model}"`);
  }
}

function assertSameSelection(label: string, expected: ExecutorSelection, actual: ExecutorSelection | undefined): void {
  if (actual === undefined) {
    return;
  }
  if (actual.executorId !== expected.executorId || actual.model !== expected.model) {
    throw new RunValidationError(
      `${label} must match the initial run selection "${expected.executorId}/${expected.model}", got "${actual.executorId}/${actual.model}".`
    );
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
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunValidationError(issue?.message ?? "Invalid run create request");
    }

    const workspace = await getWorkspaceRepository().get(parsed.data.workspaceId); // throws WorkspaceNotFoundError → 404

    const legacySelection = resolveLegacyModelSelection(parsed.data.model);
    const planningSelection: ExecutorSelection = {
      executorId: parsed.data.planningExecutorId ?? legacySelection.executorId ?? CLAUDE_CODE_EXECUTOR_ID,
      model: parsed.data.planningModel ?? legacySelection.model
    };
    validateExecutionSelection(planningSelection);
    validateExecutionSelection(parsed.data.defaultExecutionSelection);
    validateExecutionSelection(parsed.data.defaultRepairSelection);
    assertSameSelection("defaultExecutionSelection", planningSelection, parsed.data.defaultExecutionSelection);
    assertSameSelection("defaultRepairSelection", planningSelection, parsed.data.defaultRepairSelection);
    const runSelection = planningSelection;

    const now = new Date().toISOString();
    const runId = randomUUID();
    const userPrompt = parsed.data.userPrompt ?? "";

    if (userPrompt.trim().length === 0) {
      throw new RunValidationError("A user prompt is required to create a run.");
    }

    const title = userPrompt.slice(0, 120);
    const record: RunRecord = {
      runId,
      workspaceId: parsed.data.workspaceId,
      ...(parsed.data.repoSpec !== undefined
        ? { repoSpec: parsed.data.repoSpec }
        : workspace.repoPath !== undefined
          ? { repoSpec: { kind: "localPath" as const, path: workspace.repoPath } }
          : {}),
      granularity: parsed.data.granularity,
      model: runSelection.model,
      planningModel: runSelection.model,
      planningExecutorId: runSelection.executorId,
      defaultExecutionSelection: runSelection,
      defaultRepairSelection: runSelection,
      executionConfig: { routing: "fixed" as const },
      autonomy: parsed.data.autonomy ?? "supervised",
      userPrompt,
      title,
      version: 0,
      status: "created",
      createdAt: now,
      updatedAt: now,
      patches: []
    };
    const saved = await getRunRepository().save(record);

    // Fire-and-forget planning pipeline; failures land as `failed` on disk.
    startRunBackgroundTask(saved.runId, "route:create:planning", () => runPlanningPipeline(saved.runId));

    return NextResponse.json(toRunResponse(saved), { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
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
