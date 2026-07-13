import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import type { Actor, RunEvent, RunEventPayloads, RunEventType } from "@/lib/run-model/types";
import type { RunRecord } from "./schema";
import { resolveRunsDirectory } from "./repository";
import { executionSelection, planningSelection, repairSelection } from "./executor-selection";
import { projectRunRecordToRunEvents, runControlForRun } from "./run-model-projection";
import { publishRunModelBusEvent } from "./run-model-event-bus";
import { globalSingleton } from "../global-singleton";

const ATOMIC_RENAME_RETRIES = 5;

export type RunModelEventInput<K extends RunEventType = RunEventType> = {
  /** Stable producer identity: retries return the existing durable event. */
  eventId?: string;
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
  return (await inspectRunModelEventLog(runId)).events;
}

export interface RunModelEventLogInspection {
  events: RunEvent[];
  /** `degraded` is a repairable trailing partial line; `corrupt` is a real invalid record. */
  status: "ok" | "degraded" | "corrupt";
  reason?: string;
}

export interface RunModelEventBatch {
  events: RunEvent[];
  nextCursor: number;
  hasMore: boolean;
  status: "ok" | "degraded";
  /** True when the reader resumed from the sparse offset index rather than byte zero. */
  indexed: boolean;
}

interface SparseOffset { seq: number; offset: number; }
interface SparseOffsetCache { size: number; mtimeMs: number; offsets: SparseOffset[]; }
const sparseOffsetCaches = globalSingleton("run-model-event-log:sparse-offsets", () => new Map<string, SparseOffsetCache>());
const OFFSET_STRIDE = 256;

/**
 * B-027 incremental reader. It scans JSONL as a stream so reconnects retain
 * only the requested delta in memory; callers resume from the durable seq.
 */
export async function readRunModelEventBatch(runId: string, afterSeq: number, limit = 250): Promise<RunModelEventBatch> {
  const safeLimit = Math.max(1, Math.min(limit, 1_000));
  const file = filePathFor(runId);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(file);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { events: [], nextCursor: afterSeq, hasMore: false, status: "ok", indexed: false };
    throw error;
  }
  const cached = sparseOffsetCaches.get(file);
  const cache = cached?.size === info.size && cached.mtimeMs === info.mtimeMs ? cached : undefined;
  const start = cache?.offsets.filter((entry) => entry.seq <= afterSeq + 1).at(-1);
  const startOffset = start?.offset ?? 0;
  const events: RunEvent[] = [];
  let expectedSeq = start?.seq ?? 1;
  let byteOffset = startOffset;
  const offsets = cache?.offsets ?? [];
  let hasMore = false;
  let status: "ok" | "degraded" = "ok";
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: "utf8", start: startOffset }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const lineOffset = byteOffset;
    byteOffset += Buffer.byteLength(line, "utf8") + 1;
    let event: RunEvent;
    try {
      event = JSON.parse(line) as RunEvent;
    } catch {
      status = "degraded";
      break;
    }
    if (!isEventShape(event, runId) || event.seq !== expectedSeq) {
      status = "degraded";
      break;
    }
    const durable = event as Partial<DurableRunEvent>;
    if (durable.schemaVersion !== undefined && (durable.schemaVersion !== 1 || typeof durable.eventId !== "string" || typeof durable.checksum !== "string" || durable.checksum !== checksumFor(durable as DurableRunEvent))) {
      status = "degraded";
      break;
    }
    expectedSeq += 1;
    if (event.seq % OFFSET_STRIDE === 1 && !offsets.some((entry) => entry.seq === event.seq)) {
      offsets.push({ seq: event.seq, offset: lineOffset });
    }
    if (event.seq <= afterSeq) continue;
    if (events.length >= safeLimit) {
      hasMore = true;
      break;
    }
    events.push(event);
  }
  sparseOffsetCaches.set(file, { size: info.size, mtimeMs: info.mtimeMs, offsets: offsets.sort((left, right) => left.seq - right.seq) });
  return { events, nextCursor: events.at(-1)?.seq ?? afterSeq, hasMore, status, indexed: startOffset > 0 };
}

export async function inspectRunModelEventLog(runId: string): Promise<RunModelEventLogInspection> {
  try {
    return inspectRawLog(runId, await readFile(filePathFor(runId), "utf8"));
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { events: [], status: "ok" };
    throw error;
  }
}

export async function ensureRunModelEventLogForRun(run: RunRecord): Promise<RunEvent[]> {
  const existing = await readRunModelEvents(run.runId);
  if (existing.length > 0) return reconcileExistingRunModelEventLog(run, existing);

  const projected = safeProjectRunRecordToRunEvents(run);
  if (projected.length === 0) return [];

  return withLock(run.runId, async () => {
    const current = await inspectRunModelEventLog(run.runId);
    if (current.events.length > 0) return current.events;
    return appendInputsLocked(
      run.runId,
      projected.map((event) => ({ actor: event.actor, at: event.at, type: event.type as RunEventType, payload: event.payload }))
    );
  });
}

async function reconcileExistingRunModelEventLog(run: RunRecord, existing: RunEvent[]): Promise<RunEvent[]> {
  if (requiredInputsForRun(run, existing).length === 0) return existing;

  return withLock(run.runId, async () => {
    const current = await readRunModelEvents(run.runId);
    const required = requiredInputsForRun(run, current);
    if (required.length === 0) return current;
    const appended = await appendInputsLocked(run.runId, required);
    return [...current, ...appended.filter((event) => !current.some((existing) => existing.eventId === event.eventId))];
  });
}

/** B-018 recovery outbox: durable RunRecord facts repair their required projection once. */
function requiredInputsForRun(run: RunRecord, events: RunEvent[]): RunModelEventInput[] {
  const required: RunModelEventInput[] = [];
  if (needsApprovalResolutionEvent(run, events)) {
    required.push({
      eventId: `legacy-approval-resolution:${run.runId}:${run.approvedAt ?? run.updatedAt}`,
      actor: "human",
      at: run.approvedAt ?? run.updatedAt,
      type: "decision.resolved",
      payload: { decisionId: "approve_plan", choice: { action: "approve" }, actor: "human" }
    });
  }
  return required;
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
  return withLock(runId, async () => (await appendInputsLocked(runId, [input]))[0]!);
}

export async function appendRunEventsRequired(
  runId: string,
  inputs: readonly RunModelEventInput[]
): Promise<RunEvent[]> {
  if (inputs.length === 0) return [];
  return withLock(runId, async () => appendInputsLocked(runId, inputs));
}

/**
 * Required lifecycle/audit event: callers must await this and fail the current
 * operation if the append-only event log cannot be written.
 */
export const appendRunEventRequired = appendRunModelEvent;

/** Build a required event from its durable sequence while holding the append lock. */
export async function appendRunEventRequiredWithSeq<K extends RunEventType>(
  runId: string,
  build: (seq: number) => RunModelEventInput<K>
): Promise<RunEvent> {
  return withLock(runId, async () => {
    const inspection = await inspectRunModelEventLog(runId);
    if (inspection.status === "corrupt") throw new Error(`Run event log ${runId} is corrupt: ${inspection.reason ?? "unknown"}`);
    return (await appendInputsLocked(runId, [build((inspection.events.at(-1)?.seq ?? 0) + 1)]))[0]!;
  });
}

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

// Fire-and-forget publishes tracked for test drains: a publish still in flight
// when a test restores MANYHANDS_RUNS_DIR would write into the REAL runs dir.
// On globalThis: publishes happen from several Next route bundles.
const pendingPublishes = globalSingleton(
  "run-model-event-log:pending-publishes",
  () => new Set<Promise<unknown>>()
);

export function publishRunModelEvent<K extends RunEventType>(runId: string, input: RunModelEventInput<K>): void {
  const write = appendRunEventBestEffort(runId, input).finally(() => pendingPublishes.delete(write));
  pendingPublishes.add(write);
}

/** Await every fire-and-forget publish currently in flight (test teardown). */
export async function drainRunModelEventWritesForTests(): Promise<void> {
  while (pendingPublishes.size > 0) {
    await Promise.allSettled(Array.from(pendingPublishes));
  }
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

type DurableRunEvent = RunEvent & { schemaVersion: 1; eventId: string; checksum: string };

async function appendInputsLocked(runId: string, inputs: readonly RunModelEventInput[]): Promise<RunEvent[]> {
  const inspection = await inspectWritableRunModelEventLog(runId);
  if (inspection.status === "corrupt") {
    throw new Error(`Run event log ${runId} is corrupt: ${inspection.reason ?? "unknown corruption"}`);
  }

  const byId = new Map(
    inspection.events
      .filter((event): event is RunEvent & { eventId: string } => event.eventId !== undefined)
      .map((event) => [event.eventId, event])
  );
  let seq = inspection.events.at(-1)?.seq ?? 0;
  const appended: RunEvent[] = [];
  const newLines: string[] = [];
  for (const input of inputs) {
    const eventId = input.eventId ?? randomUUID();
    const existing = byId.get(eventId);
    if (existing !== undefined) {
      appended.push(existing);
      continue;
    }
    const event: DurableRunEvent = {
      schemaVersion: 1,
      eventId,
      seq: ++seq,
      at: input.at ?? new Date().toISOString(),
      runId,
      actor: input.actor,
      type: input.type,
      payload: input.payload as Record<string, unknown>,
      checksum: ""
    };
    event.checksum = checksumFor(event);
    byId.set(eventId, event);
    appended.push(event);
    newLines.push(JSON.stringify(event));
  }

  if (newLines.length > 0 || inspection.status === "degraded") {
    await atomicWriteEventLog(runId, [...inspection.validLines, ...newLines]);
  }
  for (const event of appended) {
    if (!inspection.events.some((existing) => existing.eventId === event.eventId)) {
      publishRunModelBusEvent(runId, event);
    }
  }
  return appended;
}

async function inspectWritableRunModelEventLog(
  runId: string
): Promise<RunModelEventLogInspection & { validLines: string[] }> {
  try {
    return inspectRawLog(runId, await readFile(filePathFor(runId), "utf8"));
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { events: [], validLines: [], status: "ok" };
    throw error;
  }
}

function inspectRawLog(runId: string, raw: string): RunModelEventLogInspection & { validLines: string[] } {
  const lines = raw.split(/\r?\n/);
  const validLines: string[] = [];
  const events: RunEvent[] = [];
  const eventIds = new Set<string>();
  let expectedSeq = 1;
  const lastNonEmpty = lines.reduce((last, line, index) => (line.trim().length > 0 ? index : last), -1);

  for (let index = 0; index <= lastNonEmpty; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) continue;
    let event: RunEvent;
    try {
      event = JSON.parse(line) as RunEvent;
    } catch {
      if (index === lastNonEmpty && !raw.endsWith("\n")) {
        return { events, validLines, status: "degraded", reason: "trailing partial JSONL line" };
      }
      return { events, validLines, status: "corrupt", reason: `invalid JSON at line ${index + 1}` };
    }
    if (!isEventShape(event, runId)) {
      return { events, validLines, status: "corrupt", reason: `invalid envelope at line ${index + 1}` };
    }
    const durable = event as Partial<DurableRunEvent>;
    if (durable.schemaVersion !== undefined) {
      if (durable.schemaVersion !== 1 || typeof durable.eventId !== "string" || typeof durable.checksum !== "string") {
        return { events, validLines, status: "corrupt", reason: `invalid durable envelope at line ${index + 1}` };
      }
      if (durable.checksum !== checksumFor(durable as DurableRunEvent)) {
        return { events, validLines, status: "corrupt", reason: `checksum mismatch at line ${index + 1}` };
      }
    }
    if (event.seq !== expectedSeq) {
      return { events, validLines, status: "corrupt", reason: `non-monotonic seq at line ${index + 1}` };
    }
    expectedSeq += 1;
    if (event.eventId !== undefined && eventIds.has(event.eventId)) {
      return { events, validLines, status: "corrupt", reason: `duplicate eventId at line ${index + 1}` };
    }
    if (event.eventId !== undefined) eventIds.add(event.eventId);
    validLines.push(line);
    events.push(event);
  }
  return { events, validLines, status: "ok" };
}

function isEventShape(event: RunEvent, runId: string): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    event.runId === runId &&
    Number.isInteger(event.seq) &&
    event.seq > 0 &&
    typeof event.at === "string" &&
    typeof event.actor === "string" &&
    typeof event.type === "string" &&
    typeof event.payload === "object" &&
    event.payload !== null
  );
}

function checksumFor(event: DurableRunEvent): string {
  const content = JSON.stringify({
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    seq: event.seq,
    at: event.at,
    runId: event.runId,
    actor: event.actor,
    type: event.type,
    payload: event.payload
  });
  return createHash("sha256").update(content).digest("hex");
}

async function atomicWriteEventLog(runId: string, lines: readonly string[]): Promise<void> {
  const file = filePathFor(runId);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
  try {
    await renameWithRetry(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Windows can retain a transient handle on an event log during atomic publish. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = isErrno(error) ? error.code : undefined;
      if (attempt >= ATOMIC_RENAME_RETRIES || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

function filePathFor(runId: string): string {
  return path.join(resolveRunsDirectory(), `${safeFileName(runId)}.events.jsonl`);
}

function safeFileName(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(runId) ?? Promise.resolve();
  const next = previous.then(() => withFilesystemLock(runId, fn), () => withFilesystemLock(runId, fn));
  writeChains.set(runId, next.catch(() => undefined));
  return next;
}

async function withFilesystemLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const locks = path.join(resolveRunsDirectory(), ".event-locks");
  const lock = path.join(locks, safeFileName(runId));
  await mkdir(locks, { recursive: true });
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      await mkdir(lock);
      await writeFile(path.join(lock, "owner"), `${process.pid}\n${Date.now()}`, "utf8");
      break;
    } catch (error) {
      if (!isErrno(error) || error.code !== "EEXIST") throw error;
      const info = await stat(lock).catch(() => undefined);
      if (info !== undefined && Date.now() - info.mtimeMs > 30_000) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out locking event log for ${runId}.`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await fn();
  } finally {
    await removeEventLock(lock);
  }
}

/** Windows can hold a directory handle briefly after owner write/rename. */
async function removeEventLock(lock: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(lock, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = isErrno(error) ? error.code : undefined;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  throw lastError;
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
