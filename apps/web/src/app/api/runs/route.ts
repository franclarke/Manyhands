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
import { toRunPreview, toRunResponse } from "@/lib/server/runs/presenter";
import { findScenario } from "@/lib/scenarios";
import {
  WorkspaceNotFoundError,
  getWorkspaceRepository
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
    // Prompt-only path: scenarioId is optional. When present, validate it.
    // When absent, the runner builds a FeatureRequest from the user prompt.
    const scenarioId = parsed.data.scenarioId;
    let scenarioName: string | undefined;

    if (scenarioId !== undefined) {
      const scenario = findScenario(scenarioId);
      if (scenario === undefined) {
        throw new RunValidationError(`Unknown scenarioId: ${scenarioId}`);
      }
      // "auto" resolves to "balanced" at runtime, so skip scenario granularity validation.
      if (parsed.data.granularity !== "auto" && !scenario.supportedGranularities.includes(parsed.data.granularity)) {
        throw new RunValidationError(
          `Scenario ${scenario.id} does not support granularity ${parsed.data.granularity}`
        );
      }
      scenarioName = scenario.name;
    }

    const workspace = await getWorkspaceRepository().get(parsed.data.workspaceId); // throws WorkspaceNotFoundError → 404

    const now = new Date().toISOString();
    const runId = randomUUID();
    const userPrompt = parsed.data.userPrompt ?? "";

    // Prompt-only runs require a non-empty prompt.
    if (scenarioId === undefined && userPrompt.trim().length === 0) {
      throw new RunValidationError(
        "A user prompt is required when no scenario is selected."
      );
    }

    const title = userPrompt.length > 0
      ? userPrompt.slice(0, 120)
      : scenarioName ?? "Untitled run";
    const record: RunRecord = {
      runId,
      workspaceId: parsed.data.workspaceId,
      ...(scenarioId !== undefined ? { scenarioId } : {}),
      ...(parsed.data.repoSpec !== undefined
        ? { repoSpec: parsed.data.repoSpec }
        : scenarioId === undefined && workspace.repoPath !== undefined
          ? { repoSpec: { kind: "localPath" as const, path: workspace.repoPath } }
          : {}),
      granularity: parsed.data.granularity,
      model: parsed.data.model,
      userPrompt,
      title,
      status: "created",
      createdAt: now,
      updatedAt: now,
      patches: []
    };
    const saved = await getRunRepository().save(record);

    // Fire-and-forget planning pipeline; failures land as `failed` on disk.
    void runPlanningPipeline(saved.runId).catch(() => undefined);

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
