import { NextResponse } from "next/server";
import { z } from "zod";
import type { projectRunRecordToSnapshot } from "@/lib/live-graph";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTaskExists,
  buildPatch,
  loadEditableRunContext,
  persistRunPatches,
  type RunPatch
} from "@/lib/server/runs";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { effectiveExecutionConfig } from "@/lib/server/runs/effective-execution-config";
import { findModelForSelection, normalizeExecutorOverride, type ExecutorSelection } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

const EditableStringSchema = z.string().trim().min(1);

const NodeEditRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  title: EditableStringSchema.max(160).optional(),
  objective: EditableStringSchema.max(4000).optional(),
  allowedPaths: z.array(EditableStringSchema.max(500)).optional(),
  forbiddenPaths: z.array(EditableStringSchema.max(500)).optional(),
  acceptanceCriteria: z.array(EditableStringSchema.max(500)).optional(),
  manual: z.boolean().optional(),
  executorOverride: z
    .object({
      executorId: z.literal("claude-code-cli"),
      model: EditableStringSchema.max(120)
    })
    .nullable()
    .optional(),
  executorSelection: z
    .object({
      executorId: z.enum(["claude-code-cli", "codex-cli", "opencode-cli"]),
      model: EditableStringSchema.max(120)
    })
    .nullable()
    .optional()
}).strict();

type NodeEditRequest = z.infer<typeof NodeEditRequestSchema>;

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, taskId } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  try {
    const parsed = NodeEditRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RunValidationError(issue?.message ?? "Invalid node edit request");
    }

    const { run, baseSnapshot, currentSnapshot } = await loadEditableRunContext(id);
    assertTaskExists(currentSnapshot, taskId);
    const node = currentSnapshot.graphSnapshot.nodes[taskId];
    assertNodeRoutingIsEditable(run.executionConfig, parsed.data);
    validateNodeSelection(parsed.data.executorSelection);
    validateNodeSelection(parsed.data.executorOverride);

    const patches = buildNodeEditPatches({
      input: parsed.data,
      taskId,
      currentNode: node!,
      currentContracts: currentSnapshot.contracts
    });
    if (patches.length === 0) {
      throw new RunValidationError("No editable fields were supplied");
    }

    const saved = await persistRunPatches({
      run,
      baseSnapshot,
      patches,
      expectedVersion: parsed.data.expectedVersion
    });

    return NextResponse.json(await toCanonicalRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

function buildNodeEditPatches(input: {
  input: NodeEditRequest;
  taskId: string;
  currentNode: NonNullable<ReturnType<typeof projectRunRecordToSnapshot>>["graphSnapshot"]["nodes"][string];
  currentContracts: NonNullable<ReturnType<typeof projectRunRecordToSnapshot>>["contracts"];
}): RunPatch[] {
  const { taskId, currentNode, currentContracts } = input;
  const request = input.input;
  const now = new Date().toISOString();
  const patches: RunPatch[] = [];
  const contract = currentNode.contract ?? currentContracts.find((entry) => entry.taskId === taskId);

  if (request.title !== undefined) {
    patches.push(buildPatch("NODE_RENAMED", { taskId, title: request.title }, { createdAt: now }));
  }
  if (request.objective !== undefined) {
    patches.push(buildPatch("NODE_OBJECTIVE_EDITED", { taskId, objective: request.objective }, { createdAt: now }));
  }
  if (request.allowedPaths !== undefined || request.forbiddenPaths !== undefined) {
    patches.push(
      buildPatch(
        "NODE_PATHS_EDITED",
        {
          taskId,
          allowedPaths: request.allowedPaths ?? contract?.allowed.paths ?? [],
          forbiddenPaths: request.forbiddenPaths ?? contract?.forbidden.paths ?? []
        },
        { createdAt: now }
      )
    );
  }
  if (request.acceptanceCriteria !== undefined) {
    patches.push(
      buildPatch(
        "NODE_ACCEPTANCE_EDITED",
        {
          taskId,
          acceptanceCriteria: request.acceptanceCriteria
        },
        { createdAt: now }
      )
    );
  }
  if (request.manual !== undefined) {
    patches.push(buildPatch("NODE_MARKED_MANUAL", { taskId, manual: request.manual }, { createdAt: now }));
  }
  if (request.executorOverride !== undefined) {
    const current = normalizeExecutorOverride(currentNode.metadata?.executorOverride) ?? null;
    const next = request.executorOverride;
    if (
      current?.executorId !== next?.executorId ||
      current?.model !== next?.model
    ) {
      patches.push(buildPatch("NODE_EXECUTOR_EDITED", { taskId, executorOverride: next }, { createdAt: now }));
    }
  }
  if (request.executorSelection !== undefined) {
    const current =
      normalizeExecutorOverride(currentNode.metadata?.executorSelection) ??
      normalizeExecutorOverride(currentNode.metadata?.executorOverride) ??
      null;
    const next = request.executorSelection;
    if (
      current?.executorId !== next?.executorId ||
      current?.model !== next?.model
    ) {
      patches.push(buildPatch("NODE_EXECUTOR_SELECTION_EDITED", { taskId, executorSelection: next }, { createdAt: now }));
    }
  }

  return patches;
}

function assertNodeRoutingIsEditable(
  executionConfig: Parameters<typeof effectiveExecutionConfig>[0],
  request: NodeEditRequest
): void {
  if (effectiveExecutionConfig(executionConfig).routing !== "fixed") return;
  const requestedSelections = [request.executorSelection, request.executorOverride]
    .filter((selection) => selection !== undefined);
  if (requestedSelections.some((selection) => selection !== null)) {
    throw new RunValidationError(
      "Per-node executor selection is unavailable because this run's routing is fixed. " +
      "All tasks inherit the run-level executor; send null only to remove a legacy override."
    );
  }
}

function validateNodeSelection(selection: ExecutorSelection | null | undefined): void {
  if (selection === undefined || selection === null) {
    return;
  }
  const model = findModelForSelection(selection);
  if (model === undefined || !model.enabled) {
    throw new RunValidationError(`Unsupported executor/model selection "${selection.executorId}/${selection.model}"`);
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
