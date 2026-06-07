import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Actor, RunEvent, RunEventPayloads, RunEventType } from "@/lib/run-model/types";
import type { RunRecord } from "./schema";
import { resolveRunsDirectory } from "./repository";
import { projectRunRecordToRunEvents } from "./run-model-projection";
import { publishRunModelBusEvent } from "./run-model-event-bus";

export type RunModelEventInput<K extends RunEventType = RunEventType> = {
  at?: string;
  actor: Actor;
  type: K;
  payload: RunEventPayloads[K];
};

const writeChains = new Map<string, Promise<unknown>>();

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
  if (existing.length > 0) return existing;

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

export function publishRunModelEvent<K extends RunEventType>(runId: string, input: RunModelEventInput<K>): void {
  void appendRunModelEvent(runId, input).catch((error) => {
    console.warn(
      `[run-model-event-log] failed to append ${input.type} for ${runId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });
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
  const events: RunEvent[] = [
    {
      seq: 1,
      at: run.createdAt,
      runId: run.runId,
      actor: "system",
      type: "run.created",
      payload: {
        intent: run.title,
        workspaceId: run.workspaceId,
        config: {
          aggressiveness: run.granularity === "fine" ? "high" : run.granularity === "coarse" ? "low" : "medium",
          planningModel: run.planningModel ?? run.model,
          executionSelection: run.defaultExecutionSelection ?? { executorId: "gemini-cli", model: run.model },
          repairSelection: run.defaultRepairSelection ?? run.defaultExecutionSelection ?? { executorId: "gemini-cli", model: run.model }
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
