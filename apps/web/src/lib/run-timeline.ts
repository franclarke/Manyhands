import type { RunSnapshot, TraceEvent } from "@manyhands/core";
import type { RunPatch } from "@/lib/server/runs/patches";
import type { RunRecord, RunStatus } from "@/lib/server/runs/schema";

export type TimelineEntryKind = "status" | "trace" | "patch";

export interface TimelineRunInput {
  runId: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  approvedAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

export interface RunTimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  type: string;
  timestamp: string;
  actor: "system" | "human" | "agent";
  title: string;
  summary?: string;
  taskIds: string[];
  patchType?: RunPatch["type"];
  patchId?: string;
}

export function mergeRunTimeline(input: {
  run: TimelineRunInput | RunRecord;
  snapshot: RunSnapshot;
  patches: readonly unknown[];
}): RunTimelineEntry[] {
  const patches = runPatchesFromUnknown(input.patches);
  const patchIds = new Set(patches.map((patch) => patch.id));
  const entries: Array<RunTimelineEntry & { order: number }> = [];
  let order = 0;

  entries.push(withOrder(statusEntry("run.created", input.run.createdAt, "Run created"), order++));
  if (input.run.startedAt !== undefined) {
    entries.push(withOrder(statusEntry("run.started", input.run.startedAt, "Run started"), order++));
  }
  if (input.run.approvedAt !== undefined) {
    entries.push(withOrder(statusEntry("run.approved", input.run.approvedAt, "Plan approved"), order++));
  }
  if (input.run.completedAt !== undefined) {
    entries.push(withOrder(statusEntry("run.completed", input.run.completedAt, "Run completed"), order++));
  }
  if (input.run.updatedAt !== undefined && input.run.updatedAt !== input.run.createdAt) {
    entries.push(withOrder(statusEntry(`run.status.${input.run.status}`, input.run.updatedAt, `Status: ${input.run.status}`), order++));
  }

  for (const event of input.snapshot.traceEvents) {
    const patchId = stringPayload(event, "patchId");
    if (event.type === "dag_patch_appended" && patchId !== undefined && patchIds.has(patchId)) {
      continue;
    }
    entries.push(withOrder(traceEntry(event), order++));
  }

  for (const patch of patches) {
    entries.push(withOrder(patchEntry(patch), order++));
  }

  return entries
    .sort((left, right) => {
      const byTime = Date.parse(left.timestamp) - Date.parse(right.timestamp);
      if (byTime !== 0 && !Number.isNaN(byTime)) {
        return byTime;
      }
      return left.order - right.order;
    })
    .map(({ order: _order, ...entry }) => entry);
}

function statusEntry(type: string, timestamp: string, title: string): RunTimelineEntry {
  return {
    id: type,
    kind: "status",
    type,
    timestamp,
    actor: "system",
    title,
    taskIds: []
  };
}

function traceEntry(event: TraceEvent): RunTimelineEntry {
  const taskIds = new Set<string>();
  if (event.taskId !== undefined) {
    taskIds.add(event.taskId);
  }
  for (const taskId of stringArrayPayload(event, "taskIds")) {
    taskIds.add(taskId);
  }

  const summary = summarizeTrace(event);
  const entry: RunTimelineEntry = {
    id: event.id,
    kind: "trace",
    type: event.type,
    timestamp: event.timestamp,
    actor: event.actor,
    title: humanizeType(event.type),
    taskIds: [...taskIds]
  };
  if (summary !== undefined) {
    entry.summary = summary;
  }
  return entry;
}

function patchEntry(patch: RunPatch): RunTimelineEntry {
  const summary = summarizePatch(patch);
  const entry: RunTimelineEntry = {
    id: patch.id,
    kind: "patch",
    type: patch.type,
    timestamp: patch.createdAt,
    actor: patch.actor,
    title: titleForPatch(patch),
    taskIds: taskIdsForPatch(patch),
    patchType: patch.type,
    patchId: patch.id
  };
  if (summary !== undefined) {
    entry.summary = summary;
  }
  return entry;
}

function taskIdsForPatch(patch: RunPatch): string[] {
  switch (patch.type) {
    case "NODE_RENAMED":
    case "NODE_OBJECTIVE_EDITED":
    case "NODE_PATHS_EDITED":
    case "NODE_ACCEPTANCE_EDITED":
    case "NODE_MARKED_MANUAL":
    case "NODE_EXECUTOR_EDITED":
    case "SUBTREE_REGENERATED":
      return [patch.taskId];
    case "INTEGRATOR_NODE_CREATED": {
      const taskIds = new Set<string>([patch.taskId]);
      const integrated = patch.node.metadata?.integratesTaskIds;
      if (Array.isArray(integrated)) {
        for (const taskId of integrated) {
          if (typeof taskId === "string") {
            taskIds.add(taskId);
          }
        }
      }
      return [...taskIds];
    }
    case "TASKS_SERIALIZED":
    case "DEPENDENCY_REMOVED":
      return [patch.fromTaskId, patch.toTaskId];
    case "RISK_ACKNOWLEDGED":
      return [...patch.taskIds];
  }
}

function titleForPatch(patch: RunPatch): string {
  switch (patch.type) {
    case "NODE_RENAMED":
      return "Node renamed";
    case "NODE_OBJECTIVE_EDITED":
      return "Node objective edited";
    case "NODE_PATHS_EDITED":
      return "Node paths edited";
    case "NODE_ACCEPTANCE_EDITED":
      return "Acceptance criteria edited";
    case "NODE_MARKED_MANUAL":
      return patch.manual ? "Node marked manual" : "Node marked AI-generated";
    case "NODE_EXECUTOR_EDITED":
      return patch.executorOverride === null ? "Node model reset" : "Node model edited";
    case "SUBTREE_REGENERATED":
      return "Subtree regenerated";
    case "INTEGRATOR_NODE_CREATED":
      return "Integrator node created";
    case "TASKS_SERIALIZED":
      return "Tasks serialized";
    case "DEPENDENCY_REMOVED":
      return "Dependency removed";
    case "RISK_ACKNOWLEDGED":
      return "Risk acknowledged";
  }
}

function summarizePatch(patch: RunPatch): string | undefined {
  switch (patch.type) {
    case "NODE_RENAMED":
      return patch.title;
    case "NODE_OBJECTIVE_EDITED":
      return patch.objective;
    case "NODE_PATHS_EDITED":
      return `${patch.allowedPaths.length} allowed paths, ${patch.forbiddenPaths.length} forbidden paths`;
    case "NODE_ACCEPTANCE_EDITED":
      return `${patch.acceptanceCriteria.length} acceptance criteria`;
    case "NODE_EXECUTOR_EDITED":
      return patch.executorOverride === null
        ? "Uses run default model"
        : `${patch.executorOverride.executorId} / ${patch.executorOverride.model}`;
    case "SUBTREE_REGENERATED":
      return `${patch.removedTaskIds.length} removed, ${Object.keys(patch.nodes).length} inserted`;
    case "INTEGRATOR_NODE_CREATED":
      return patch.node.title;
    case "TASKS_SERIALIZED":
    case "DEPENDENCY_REMOVED":
      return patch.rationale;
    case "RISK_ACKNOWLEDGED":
      return patch.reason;
    case "NODE_MARKED_MANUAL":
      return undefined;
  }
}

function summarizeTrace(event: TraceEvent): string | undefined {
  const reason = stringPayload(event, "reason");
  if (reason !== undefined) {
    return reason;
  }
  const recommendation = stringPayload(event, "recommendation");
  if (recommendation !== undefined) {
    return recommendation;
  }
  const patchType = stringPayload(event, "patchType");
  if (patchType !== undefined) {
    return patchType;
  }
  return undefined;
}

function humanizeType(type: string): string {
  return type.replaceAll("_", " ");
}

function stringPayload(event: TraceEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayPayload(event: TraceEvent, key: string): string[] {
  const value = event.payload[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function withOrder<T extends RunTimelineEntry>(entry: T, order: number): T & { order: number } {
  return { ...entry, order };
}

function runPatchesFromUnknown(values: readonly unknown[]): RunPatch[] {
  return values.filter((value): value is RunPatch => {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.id === "string" &&
      typeof record.type === "string" &&
      typeof record.createdAt === "string" &&
      (record.actor === "human" || record.actor === "system");
  });
}
