import { randomUUID } from "node:crypto";
import {
  validateTaskGraph,
  type MockPlanningFlowResult,
  type RunSnapshot,
  type TaskGraph,
  type TraceEvent
} from "@manyhands/core";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { publishRunEvent } from "./event-bus";
import { RunLifecycleError } from "./errors";
import { getRunRepository } from "./store";
import {
  appendPatch,
  applyPatches,
  type RunPatch
} from "./patches";
import type { RunRecord } from "./schema";

export interface EditableRunContext {
  run: RunRecord;
  baseSnapshot: RunSnapshot;
  currentSnapshot: RunSnapshot;
}

export async function loadEditableRunContext(runId: string): Promise<EditableRunContext> {
  const run = await getRunRepository().get(runId);
  assertEditableRun(run);

  const baseSnapshot = projectRunRecordToSnapshot(run, { applyPatches: false });
  if (baseSnapshot === null) {
    throw new RunLifecycleError("Run does not have a generated DAG to edit");
  }

  return {
    run,
    baseSnapshot,
    currentSnapshot: applyPatches(baseSnapshot, run.patches ?? [])
  };
}

export async function persistRunPatches(input: {
  run: RunRecord;
  baseSnapshot: RunSnapshot;
  patches: readonly RunPatch[];
}): Promise<RunRecord> {
  if (input.patches.length === 0) {
    throw new RunLifecycleError("No patches were supplied");
  }

  let candidate: RunSnapshot;
  try {
    candidate = applyPatches(input.baseSnapshot, [...(input.run.patches ?? []), ...input.patches]);
  } catch (error) {
    throw new RunLifecycleError(error instanceof Error ? error.message : String(error));
  }

  const issues = validateTaskGraph(candidate.graphSnapshot as unknown as TaskGraph).filter(
    (issue) => issue.severity === "error"
  );
  if (issues.length > 0) {
    throw new RunLifecycleError(
      `Patch would leave an invalid DAG: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`
    );
  }

  const withPatches = input.patches.reduce((run, patch) => appendPatch(run, patch), input.run);
  const withTraces = appendPatchTraceEvents(withPatches, input.patches);
  const nextRun = invalidateApprovalIfNeeded({
    ...withTraces,
    updatedAt: input.patches[input.patches.length - 1]?.createdAt ?? new Date().toISOString()
  });
  const saved = await getRunRepository().save(nextRun);

  if (input.run.status !== saved.status) {
    publishRunEvent(saved.runId, {
      kind: "status.changed",
      status: saved.status,
      at: saved.updatedAt
    });
  }

  return saved;
}

export function buildPatch<TType extends RunPatch["type"]>(
  type: TType,
  payload: Omit<Extract<RunPatch, { type: TType }>, "id" | "createdAt" | "actor" | "type">,
  options: { createdAt?: string; actor?: Extract<RunPatch["actor"], "human" | "system"> } = {}
): Extract<RunPatch, { type: TType }> {
  return {
    id: `patch-${randomUUID()}`,
    createdAt: options.createdAt ?? new Date().toISOString(),
    actor: options.actor ?? "human",
    type,
    ...payload
  } as Extract<RunPatch, { type: TType }>;
}

export function assertTaskExists(snapshot: RunSnapshot, taskId: string): void {
  if (snapshot.graphSnapshot.nodes[taskId] === undefined) {
    throw new RunLifecycleError(`Task ${taskId} does not exist`);
  }
}

export function assertEditableRun(run: RunRecord): void {
  if (run.status !== "needs_review" && run.status !== "approved") {
    throw new RunLifecycleError(`Run ${run.runId} cannot be edited while status is ${run.status}`);
  }
  if (run.planning === undefined) {
    throw new RunLifecycleError(`Run ${run.runId} does not have a generated plan`);
  }
}

function appendPatchTraceEvents(run: RunRecord, patches: readonly RunPatch[]): RunRecord {
  const planning = run.planning as MockPlanningFlowResult | undefined;
  if (planning === undefined) {
    return run;
  }

  const traceEvents: TraceEvent[] = patches.map((patch, index) => {
    const taskId = "taskId" in patch ? patch.taskId : undefined;
    const event: TraceEvent = {
      id: `trace-${patch.id}`,
      type: "dag_patch_appended",
      timestamp: patch.createdAt,
      actor: patch.actor,
      planId: planning.decomposition.graph.planId,
      payload: {
        patchId: patch.id,
        patchType: patch.type,
        order: planning.traces.length + index + 1
      }
    };
    if (taskId !== undefined) {
      event.taskId = taskId;
    }
    return event;
  });

  return {
    ...run,
    planning: {
      ...planning,
      traces: [...planning.traces, ...traceEvents]
    }
  };
}

function invalidateApprovalIfNeeded(run: RunRecord): RunRecord {
  if (run.status !== "approved") {
    return run;
  }
  const next: RunRecord = {
    ...run,
    status: "needs_review"
  };
  delete next.approvedAt;
  return next;
}
