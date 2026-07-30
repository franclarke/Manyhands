import { createHash } from "node:crypto";
import { open, readFile, truncate } from "node:fs/promises";
import path from "node:path";
import type { RunProjection } from "@manyhands/run-coordinator";
import {
  findLatestValidGeneration,
  readCompactedGeneration,
  restoreCompactionManifest
} from "./compactor.js";
import { atomicWriteJson } from "./durable-file.js";
import { acquireDurableLock } from "./durable-lock.js";
import type { FencingAuthority } from "./event-store.js";
import { JsonlRunEventStore } from "./jsonl-event-store.js";
import { RunSnapshotStore } from "./snapshot-store.js";
import { foldRunEvents } from "./projection-fold.js";

export interface RunStoreRecoveryOptions {
  directory?: string;
  store?: JsonlRunEventStore;
  authority?: FencingAuthority;
  rebuildSnapshot?: boolean;
}

export interface RunStoreRecoveryReport {
  runId: string;
  status: "ok" | "recovered" | "corrupt";
  repairedTrailingBytes: number;
  recoveredGeneration: number | null;
  eventCount: number;
  lastSequence: number;
  issues: string[];
  projection: RunProjection | null;
  recoverySnapshotPath: string | null;
}

export async function verifyAndRecoverRunStore(
  runId: string,
  options: RunStoreRecoveryOptions = {}
): Promise<RunStoreRecoveryReport> {
  const store = options.store ?? new JsonlRunEventStore(
    options.directory === undefined ? {} : { directory: options.directory }
  );
  const directory = store.directory;
  const issues: string[] = [];
  let repairedTrailingBytes = 0;
  let recoveredGeneration: number | null = null;

  const release = await acquireDurableLock(`${store.eventLogPath(runId)}.lock`);
  try {
    const returnAfterOwnershipCheck = async <T>(value: T): Promise<T> => {
      await release.renew();
      return value;
    };
    try {
      await readCompactedGeneration(directory, runId);
    } catch (error) {
      issues.push(`Compaction manifest was invalid: ${errorMessage(error)}`);
      const generation = await findLatestValidGeneration(directory, runId);
      if (generation === null) {
        return await returnAfterOwnershipCheck(corruptReport(runId, issues));
      }
      await restoreCompactionManifest(directory, runId, generation);
      recoveredGeneration = generation.generation;
    }

    repairedTrailingBytes = await repairIncompleteTrailingLine(store.eventLogPath(runId));
    if (repairedTrailingBytes > 0) {
      issues.push(`Removed ${repairedTrailingBytes} byte(s) from an incomplete trailing JSONL record.`);
    }
    store.invalidateCache(runId);
    const inspection = await store.inspect(runId);
    if (inspection.status === "corrupt") {
      issues.push(inspection.reason ?? "Event log integrity verification failed.");
      return await returnAfterOwnershipCheck(corruptReport(runId, issues, repairedTrailingBytes, recoveredGeneration));
    }
    if (inspection.status === "degraded") {
      issues.push(inspection.reason ?? "Event log remains degraded after repair.");
      return await returnAfterOwnershipCheck(corruptReport(runId, issues, repairedTrailingBytes, recoveredGeneration));
    }

    const projection = inspection.events.length === 0 ? null : foldRunEvents(inspection.events);
    const recoverySnapshotPath = projection === null
      ? null
      : await writeRecoverySnapshot(directory, runId, projection, inspection.events.length);
    const report: RunStoreRecoveryReport = {
      runId,
      status: repairedTrailingBytes > 0 || recoveredGeneration !== null ? "recovered" : "ok",
      repairedTrailingBytes,
      recoveredGeneration,
      eventCount: inspection.events.length,
      lastSequence: inspection.events.at(-1)?.sequence ?? 0,
      issues,
      projection,
      recoverySnapshotPath
    };
    return await returnAfterOwnershipCheck(report);
  } finally {
    await release();
  }
}

export async function rebuildCanonicalSnapshotAfterRecovery(
  runId: string,
  authority: FencingAuthority,
  options: Omit<RunStoreRecoveryOptions, "authority"> = {}
): Promise<RunProjection> {
  const store = options.store ?? new JsonlRunEventStore(
    options.directory === undefined ? {} : { directory: options.directory }
  );
  const report = await verifyAndRecoverRunStore(runId, { ...options, store });
  if (report.status === "corrupt" || report.projection === null) {
    throw new Error(`Cannot rebuild snapshot for corrupt or empty run ${runId}.`);
  }
  const snapshots = new RunSnapshotStore({ directory: store.directory, events: store });
  return snapshots.loadOrRebuild(runId, authority);
}

async function repairIncompleteTrailingLine(filePath: string): Promise<number> {
  let contents: Buffer;
  try {
    contents = await readFile(filePath);
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }
  if (contents.length === 0 || contents.at(-1) === 0x0a) return 0;
  const lastNewline = contents.lastIndexOf(0x0a);
  const validLength = lastNewline < 0 ? 0 : lastNewline + 1;
  const removed = contents.length - validLength;
  await truncate(filePath, validLength);
  const handle = await open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return removed;
}

async function writeRecoverySnapshot(
  directory: string,
  runId: string,
  projection: RunProjection,
  eventSequence: number
): Promise<string> {
  const filePath = path.join(path.resolve(directory), `${safeName(runId)}.recovery.snapshot.v1.json`);
  const base = {
    schemaVersion: 1 as const,
    runId,
    eventSequence,
    projection
  };
  await atomicWriteJson(filePath, { ...base, checksum: checksum(base) });
  return filePath;
}

function corruptReport(
  runId: string,
  issues: string[],
  repairedTrailingBytes = 0,
  recoveredGeneration: number | null = null
): RunStoreRecoveryReport {
  return {
    runId,
    status: "corrupt",
    repairedTrailingBytes,
    recoveredGeneration,
    eventCount: 0,
    lastSequence: 0,
    issues,
    projection: null,
    recoverySnapshotPath: null
  };
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeName(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
