import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Actor, RunEvent, RunEventPayloads, RunEventType } from "@/lib/run-model/types";
import type { RunRecord } from "./schema";
import { resolveRunsDirectory } from "./repository";
import { executionSelection, planningSelection, repairSelection } from "./executor-selection";
import { projectRunRecordToRunEvents, runControlForRun } from "./run-model-projection";
import { publishRunModelBusEvent } from "./run-model-event-bus";
import { globalSingleton } from "../global-singleton";

export type RunModelEventInput<K extends RunEventType = RunEventType> = {
  at?: string;
  actor: Actor;
  type: K;
  payload: RunEventPayloads[K];
};

// On globalThis: appends happen from several Next route bundles (pipelines,
// cancel, decisions); a per-bundle lock map would not serialize seq assignment.
const writeChains = globalSingleton(
  "run-model-event-log:write-chains",
  () => new Map<string, Promise<unknown>>()
);

export async function readRunModelEvents(runId: string): Promise<RunEvent[]> {
  const filePath = filePathFor(runId);
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as RunEvent)
      .sort((left, right) => left.seq - right.seq);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function ensureRunModelEventLogForRun(run: RunRecord): Promise<RunEvent[]> {
  const existing = await readRunModelEvents(run.runId);
  if (existing.length > 0) return reconcileExistingRunModelEventLog(run, existing);

  const projected = safeProjectRunRecordToRunEvents(run);
  if (projected.length === 0) return [];

  return withLock(run.runId, async () => {
    const current = await readRunModelEvents(run.runId);
    if (current.length > 0) return current;
    await mkdir(resolveRunsDirectory(), { recursive: true });
    const body = projected.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await appendFile(filePathFor(run.runId), body, "utf8");
    return projected;
  });
}

async function reconcileExistingRunModelEventLog(run: RunRecord, existing: RunEvent[]): Promise<RunEvent[]> {
  if (!needsApprovalResolutionEvent(run, existing)) return existing;

  return withLock(run.runId, async () => {
    const current = await readRunModelEvents(run.runId);
    if (!needsApprovalResolutionEvent(run, current)) return current;

    const event: RunEvent = {
      seq: (current.at(-1)?.seq ?? 0) + 1,
      at: run.approvedAt ?? run.updatedAt,
      runId: run.runId,
      actor: "human",
      type: "decision.resolved",
      payload: {
        decisionId: "approve_plan",
        choice: { action: "approve" },
        actor: "human"
      }
    };
    await appendFile(filePathFor(run.runId), `${JSON.stringify(event)}\n`, "utf8");
    publishRunModelBusEvent(run.runId, event);
    return [...current, event];
  });
}

function needsApprovalResolutionEvent(run: RunRecord, events: RunEvent[]): boolean {
  if (run.approvedAt === undefined) return false;
  const hasApprovalGate = events.some(
    (event) =>
      event.type === "decision.raised" &&
      (event.payload as { decisionId?: string }).decisionId === "approve_plan"
  );
  if (!hasApprovalGate) return false;
  return !events.some(
    (event) =>
      event.type === "decision.resolved" &&
      (event.payload as { decisionId?: string }).decisionId === "approve_plan"
  );
}

export async function appendRunModelEvent<K extends RunEventType>(
  runId: string,
  input: RunModelEventInput<K>
): Promise<RunEvent> {
  return withLock(runId, async () => {
    await mkdir(resolveRunsDirectory(), { recursive: true });
    const currentSeq = await lastSeq(runId);
    const event: RunEvent = {
      seq: currentSeq + 1,
      at: input.at ?? new Date().toISOString(),
      runId,
      actor: input.actor,
      type: input.type,
      payload: input.payload as Record<string, unknown>
    };
    await appendFile(filePathFor(runId), `${JSON.stringify(event)}\n`, "utf8");
    publishRunModelBusEvent(runId, event);
    return event;
  });
}

export async function appendRunEventsRequired(
  runId: string,
  inputs: readonly RunModelEventInput[]
): Promise<RunEvent[]> {
  if (inputs.length === 0) return [];
  return withLock(runId, async () => {
    await mkdir(resolveRunsDirectory(), { recursive: true });
    const currentSeq = await lastSeq(runId);
    const events = inputs.map((input, index): RunEvent => ({
      seq: currentSeq + index + 1,
      at: input.at ?? new Date().toISOString(),
      runId,
      actor: input.actor,
      type: input.type,
      payload: input.payload as Record<string, unknown>
    }));
    await appendFile(filePathFor(runId), events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
    for (const event of events) {
      publishRunModelBusEvent(runId, event);
    }
    return events;
  });
}

/**
 * Required lifecycle/audit event: callers must await this and fail the current
 * operation if the append-only event log cannot be written.
 */
export const appendRunEventRequired = appendRunModelEvent;

/**
 * Best-effort projection/detail event: failures are logged but do not block the
 * run. Use this only for events that can be reconstructed or are UI detail, not
 * for lifecycle status/decision/cancellation guarantees.
 */
export async function appendRunEventBestEffort<K extends RunEventType>(
  runId: string,
  input: RunModelEventInput<K>
): Promise<RunEvent | undefined> {
  try {
    return await appendRunModelEvent(runId, input);
  } catch (error) {
    console.warn(
      `[run-model-event-log] best-effort append failed for ${input.type} on ${runId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

export function publishRunModelEvent<K extends RunEventType>(runId: string, input: RunModelEventInput<K>): void {
  void appendRunEventBestEffort(runId, input);
}

export async function resetRunModelEventLogForTests(runId: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  try {
    await rm(filePathFor(runId));
  } catch (error) {
    if (!isErrno(error) || error.code !== "ENOENT") throw error;
  }
}

function safeProjectRunRecordToRunEvents(run: RunRecord): RunEvent[] {
  try {
    return projectRunRecordToRunEvents(run);
  } catch (error) {
    console.warn(
      `[run-model-event-log] projection fallback for ${run.runId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return minimalRunEvents(run);
  }
}

function minimalRunEvents(run: RunRecord): RunEvent[] {
  const planning = planningSelection(run);
  const exec = executionSelection(run);
  const repair = repairSelection(run);
  const events: RunEvent[] = [
    {
      seq: 1,
      at: run.createdAt,
      runId: run.runId,
      actor: "system",
      type: "run.created",
      payload: {
        intent: run.userPrompt || run.title,
        workspaceId: run.workspaceId,
        config: {
          aggressiveness: run.granularity === "fine" ? "high" : run.granularity === "coarse" ? "low" : "medium",
          planningModel: planning.model,
          executionSelection: exec,
          repairSelection: repair
        }
      }
    }
  ];
  if (run.provisioned !== undefined) {
    events.push({
      seq: events.length + 1,
      at: run.provisioned.provisionedAt,
      runId: run.runId,
      actor: "system",
      type: "run.context.resolved",
      payload: {
        repo: run.provisioned.repoRoot,
        baseCommit: run.provisioned.baseCommit,
        readiness: "ok"
      }
    });
  }
  events.push({
    seq: events.length + 1,
    at: run.updatedAt,
    runId: run.runId,
    actor: "system",
    type: "run.status.changed",
    payload: runControlForRun(run) as unknown as Record<string, unknown>
  });
  return events;
}

async function lastSeq(runId: string): Promise<number> {
  const events = await readRunModelEvents(runId);
  return events.at(-1)?.seq ?? 0;
}

function filePathFor(runId: string): string {
  return path.join(resolveRunsDirectory(), `${safeFileName(runId)}.events.jsonl`);
}

function safeFileName(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(runId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  writeChains.set(runId, next.catch(() => undefined));
  return next;
}

interface NodeErrnoException {
  code?: string;
}

function isErrno(value: unknown): value is NodeErrnoException {
  return typeof value === "object" && value !== null && "code" in value;
}

export async function hasRunModelEventLog(runId: string): Promise<boolean> {
  try {
    const info = await stat(filePathFor(runId));
    return info.isFile() && info.size > 0;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return false;
    throw error;
  }
}
