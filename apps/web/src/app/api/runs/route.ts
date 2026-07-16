import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  RunCreateRequestSchema,
  RUN_STATUS_VALUES,
  getRunRepository,
  listCorruptRunRecords,
  runPlanningPipeline,
  sweepManyIfStale,
  type RunRecord,
  type RunStatus
} from "@/lib/server/runs";
import { startRunBackgroundTask } from "@/lib/server/runs/runner-state";
import { captureRunTargetContext } from "@/lib/server/runs/target-context";
import { toCanonicalRunResponse, toRunPreview } from "@/lib/server/runs/presenter";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  getWorkspaceRepository,
  withWorkspaceReferenceLock
} from "@/lib/server/workspaces";
import { assertDeclaredStageSelection } from "@/lib/server/providers/capability-service";
import {
  planningSelection as resolvePlanningSelection,
  executionSelection as resolveExecutionSelection,
  repairSelection as resolveRepairSelection
} from "@/lib/server/runs/executor-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const statusParam = url.searchParams.get("status");
    const refreshDiagnostics = url.searchParams.get("diagnostics") === "refresh";
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? undefined : Math.max(1, Math.min(50, Number(limitRaw) || 0));
    const workspaceRepository = getWorkspaceRepository();
    const equivalentWorkspaceIds = workspaceId !== null && workspaceId.length > 0
      ? await workspaceRepository.equivalentIds(workspaceId)
      : undefined;
    const filter: { workspaceIds?: string[]; limit?: number } = {};
    if (equivalentWorkspaceIds !== undefined) filter.workspaceIds = equivalentWorkspaceIds;
    if (limit !== undefined && limit > 0) filter.limit = limit;
    const [rawRuns, workspaces, corruptRecords] = await Promise.all([
      getRunRepository().list(filter),
      workspaceRepository.list(),
      // The dev console polls this route frequently. Its normal path consumes
      // the durable diagnostics index without opening every RunRecord; an
      // explicit operator refresh advances the index by one bounded batch.
      listCorruptRunRecords({ inspectionBudget: refreshDiagnostics ? 8 : 0 })
    ]);
    let runs = await sweepManyIfStale(rawRuns);
    // B-007: archived runs are hidden unless explicitly requested.
    if (url.searchParams.get("include") !== "archived") {
      runs = runs.filter((entry) => entry.archivedAt === undefined);
    }
    if (statusParam !== null && statusParam.length > 0) {
      const statuses = parseStatusFilter(statusParam);
      if (statuses.length > 0) {
        runs = runs.filter((entry) => statuses.includes(entry.status));
      }
    }
    const wsByid = new Map(workspaces.map((w) => [w.id, w]));
    await Promise.all(
      [...new Set(runs.map((entry) => entry.workspaceId))].map(async (id) => {
        if (wsByid.has(id)) return;
        const workspace = await workspaceRepository.get(id).catch(() => undefined);
        if (workspace !== undefined) wsByid.set(id, workspace);
      })
    );
    return NextResponse.json({
      runs: runs.map((run) => toRunPreview(run, wsByid)),
      degradedRecords: corruptRecords.map((record) => ({
        runId: record.runId,
        reason: record.reason ?? "invalid run record",
        diagnosticsHref: `/api/runs/${encodeURIComponent(record.runId)}/diagnostics`
      }))
    });
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

/**
 * Validate the reasoning effort a request explicitly attached to a canonical
 * stage selection (U2A-2). Rejects an effort on a model that declares none, and
 * an effort value the model does not list — never a silent drop (F9).
 */
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

    const saved = await withWorkspaceReferenceLock(async () => {
    const workspace = await getWorkspaceRepository().get(parsed.data.workspaceId); // throws WorkspaceNotFoundError → 404

    // Reject an explicit request effort the model can't honour BEFORE the
    // resolver would drop it (F9: never a silent drop).
    if (parsed.data.planningSelection !== undefined) {
      assertDeclaredStageSelection("Planning", parsed.data.planningSelection, "planning");
    }
    if (parsed.data.executionSelection !== undefined) {
      assertDeclaredStageSelection("Execution", parsed.data.executionSelection, "execution");
    }
    if (parsed.data.repairSelection !== undefined) {
      assertDeclaredStageSelection("Repair", parsed.data.repairSelection, "repair");
    }

    // The read resolver is the single authority: it reconciles canonical ↔
    // legacy request fields, fails on contradiction (RunConfigurationError →
    // 400) and on unknown bare model strings, and returns full StageSelections.
    // Creation then injects the model's declared default effort (visible/persisted).
    const selectionView = {
      model: parsed.data.model,
      ...(parsed.data.planningModel !== undefined ? { planningModel: parsed.data.planningModel } : {}),
      ...(parsed.data.planningExecutorId !== undefined ? { planningExecutorId: parsed.data.planningExecutorId } : {}),
      ...(parsed.data.defaultExecutionSelection !== undefined ? { defaultExecutionSelection: parsed.data.defaultExecutionSelection } : {}),
      ...(parsed.data.defaultRepairSelection !== undefined ? { defaultRepairSelection: parsed.data.defaultRepairSelection } : {}),
      ...(parsed.data.planningSelection !== undefined ? { planningSelection: parsed.data.planningSelection } : {}),
      ...(parsed.data.executionSelection !== undefined ? { executionSelection: parsed.data.executionSelection } : {}),
      ...(parsed.data.repairSelection !== undefined ? { repairSelection: parsed.data.repairSelection } : {}),
      ...(parsed.data.executionConfig !== undefined ? { executionConfig: parsed.data.executionConfig } : {})
    };
    const planningStage = assertDeclaredStageSelection(
      "Planning",
      resolvePlanningSelection(selectionView),
      "planning"
    );
    const executionStage = assertDeclaredStageSelection(
      "Execution",
      resolveExecutionSelection(selectionView),
      "execution"
    );
    const repairStage = assertDeclaredStageSelection(
      "Repair",
      resolveRepairSelection(selectionView),
      "repair"
    );

    const now = new Date().toISOString();
    const runId = randomUUID();
    const userPrompt = parsed.data.userPrompt ?? "";

    if (userPrompt.trim().length === 0) {
      throw new RunValidationError("A user prompt is required to create a run.");
    }

    const title = userPrompt.slice(0, 120);
    const executionConfig = {
      ...(parsed.data.executionConfig ?? {}),
      ...(executionStage.effort !== undefined ? { reasoningEffort: executionStage.effort } : {}),
      routing: "fixed" as const
    };

    const repoSpec =
      parsed.data.repoSpec ??
      (workspace.repoPath !== undefined
        ? { kind: "localPath" as const, path: workspace.repoPath }
        : undefined);
    // B-008 (CF-19): freeze the target repository at creation.
    // A local target is publishable only after its physical git-common-dir
    // identity is captured; otherwise a later repo at the same path is ambiguous.
    const targetContext =
      repoSpec?.kind === "localPath" ? await captureRunTargetContext(repoSpec.path, now) : undefined;
    if (repoSpec?.kind === "localPath" && targetContext?.physicalIdentity === undefined) {
      throw new RunValidationError(
        `Cannot capture an authoritative physical identity for local repository ${repoSpec.path}. ` +
          "Verify that it is an accessible Git repository with at least one commit and retry; the run was not created."
      );
    }

    const record: RunRecord = {
      runId,
      workspaceId: workspace.id,
      ...(repoSpec !== undefined ? { repoSpec } : {}),
      ...(targetContext !== undefined ? { targetContext } : {}),
      granularity: parsed.data.granularity,
      // Canonical per-stage selections (U2A-2, authoritative).
      planningSelection: planningStage,
      executionSelection: executionStage,
      repairSelection: repairStage,
      // Legacy mirror (dual-write) so old readers and snapshots keep working.
      model: executionStage.model,
      planningModel: planningStage.model,
      planningExecutorId: planningStage.executorId,
      defaultExecutionSelection: { executorId: executionStage.executorId, model: executionStage.model },
      defaultRepairSelection: { executorId: repairStage.executorId, model: repairStage.model },
      executionConfig,
      autonomy: parsed.data.autonomy ?? "supervised",
      userPrompt,
      title,
      version: 0,
      planRevision: 1,
      status: "created",
      createdAt: now,
      updatedAt: now,
      patches: []
    };
    return getRunRepository().save(record);
    });

    // Fire-and-forget planning pipeline; failures land as `failed` on disk.
    startRunBackgroundTask(saved.runId, "route:create:planning", () => runPlanningPipeline(saved.runId));

    return NextResponse.json(await toCanonicalRunResponse(saved), { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof WorkspaceConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
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
