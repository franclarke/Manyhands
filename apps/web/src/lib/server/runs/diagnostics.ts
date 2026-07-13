import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { inspectRunModelEventLog } from "./run-model-event-log";
import { resolveRunsDirectory } from "./repository";
import { getRunRepository } from "./store";

export interface RunDiagnostics {
  generatedAt: string;
  correlation: { runId: string; operationId?: string; fencingToken?: number; finalCommitSha?: string };
  lifecycle: { status: string; updatedAt: string; archived: boolean };
  eventLog: { status: "ok" | "degraded" | "corrupt"; eventCount: number; reason?: string };
  disk: { totalBytes: number; categories: Record<string, number> };
}

/** B-032: bounded metadata-only export; no prompts, outputs, paths outside the run root, or secrets are read. */
export async function buildRunDiagnostics(runId: string): Promise<RunDiagnostics> {
  const run = await getRunRepository().get(runId);
  const eventLog = await inspectRunModelEventLog(runId);
  const runsDir = resolveRunsDirectory();
  const categories = {
    record: await fileBytes(path.join(runsDir, `${runId}.json`)),
    events: await fileBytes(path.join(runsDir, `${runId}.events.jsonl`)),
    checkpoints: await directoryBytes(path.join(runsDir, "checkpoints", runId)),
    attempts: await fileBytes(path.join(runsDir, "attempts", `${runId}.json`))
  };
  return {
    generatedAt: new Date().toISOString(),
    correlation: {
      runId,
      ...(run.activeOperation === undefined ? {} : { operationId: run.activeOperation.operationId, fencingToken: run.activeOperation.fencingToken }),
      ...(run.finalCommitSha === undefined ? {} : { finalCommitSha: run.finalCommitSha })
    },
    lifecycle: { status: run.status, updatedAt: run.updatedAt, archived: run.archivedAt !== undefined },
    eventLog: { status: eventLog.status, eventCount: eventLog.events.length, ...(eventLog.reason === undefined ? {} : { reason: eventLog.reason }) },
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
