import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { JsonFileCheckpointSaver, planningThreadId, type ThreadCheckpointHealth } from "@manyhands/orchestrator-graph";
import { inspectRunModelEventLog } from "./run-model-event-log";
import { inspectRunRecordFile, resolveRunsDirectory } from "./repository";

export interface RunDiagnostics {
  generatedAt: string;
  correlation: { runId: string; operationId?: string; fencingToken?: number; finalCommitSha?: string };
  lifecycle: { status: string; updatedAt: string; archived: boolean };
  record: { status: "ok" | "missing" | "corrupt"; reason?: string };
  eventLog: { status: "ok" | "degraded" | "corrupt"; eventCount: number; reason?: string };
  checkpoints: { execution: ThreadCheckpointHealth; planning: ThreadCheckpointHealth };
  disk: { totalBytes: number; categories: Record<string, number> };
}

/** B-032: bounded metadata-only export; no prompts, outputs, paths outside the run root, or secrets are read. */
export async function buildRunDiagnostics(runId: string): Promise<RunDiagnostics> {
  const record = await inspectRunRecordFile(runId);
  const run = record.run;
  const eventLog = await inspectRunModelEventLog(runId);
  const runsDir = resolveRunsDirectory();
  const safeId = record.fileName.slice(0, -".json".length);
  const checkpointSaver = new JsonFileCheckpointSaver(path.join(runsDir, "checkpoints"));
  const [executionCheckpoint, planningCheckpoint] = await Promise.all([
    checkpointSaver.inspectThread(safeId),
    checkpointSaver.inspectThread(planningThreadId(safeId))
  ]);
  const categories = {
    record: await fileBytes(path.join(runsDir, record.fileName)),
    events: await fileBytes(path.join(runsDir, `${safeId}.events.jsonl`)),
    checkpoints:
      (await directoryBytes(path.join(runsDir, "checkpoints", safeId))) +
      (await directoryBytes(path.join(runsDir, "checkpoints", planningThreadId(safeId)))),
    attempts: await fileBytes(path.join(runsDir, "attempts", `${safeId}.json`))
  };
  return {
    generatedAt: new Date().toISOString(),
    correlation: {
      runId,
      ...(run?.activeOperation === undefined ? {} : { operationId: run.activeOperation.operationId, fencingToken: run.activeOperation.fencingToken }),
      ...(run?.finalCommitSha === undefined ? {} : { finalCommitSha: run.finalCommitSha })
    },
    lifecycle: {
      status: run?.status ?? record.status,
      updatedAt: run?.updatedAt ?? record.updatedAt ?? new Date(0).toISOString(),
      archived: run?.archivedAt !== undefined
    },
    record: {
      status: record.status,
      ...(record.reason === undefined ? {} : { reason: record.reason })
    },
    eventLog: { status: eventLog.status, eventCount: eventLog.events.length, ...(eventLog.reason === undefined ? {} : { reason: eventLog.reason }) },
    checkpoints: { execution: executionCheckpoint, planning: planningCheckpoint },
    disk: { totalBytes: Object.values(categories).reduce((total, bytes) => total + bytes, 0), categories }
  };
}

async function fileBytes(file: string): Promise<number> {
  try { return (await stat(file)).isFile() ? (await stat(file)).size : 0; } catch { return 0; }
}

async function directoryBytes(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory() ? directoryBytes(path.join(directory, entry.name)) : entry.isFile() ? fileBytes(path.join(directory, entry.name)) : 0))).reduce((total, bytes) => total + bytes, 0);
  } catch { return 0; }
}
