import { createHash } from "node:crypto";
import { createWriteStream, fsync } from "node:fs";
import { mkdir, readFile, stat, truncate } from "node:fs/promises";
import path from "node:path";
import {
  RunEventSchema,
  type RunEvent,
  type RunEventInput,
  type RunEventJournalPort,
  type RunProjection
} from "@manyhands/run-coordinator";
import {
  CorruptRunEventLogError,
  SequenceConflictError,
  StaleFencingTokenError,
  type FencedRunEventStore,
  type FencingAuthority,
  type RunEventLogInspection
} from "./event-store.js";
import { CURRENT_EVENT_SCHEMA_VERSION, upcastEventToCurrent } from "./event-upcaster.js";
import { readCompactedGeneration } from "./compactor.js";
import { atomicWriteJson, durableWritesEnabled } from "./durable-file.js";
import { acquireDurableLock } from "./durable-lock.js";
import { foldRunEvents, reduceRunEvents } from "./projection-fold.js";

interface DurableEventEnvelope {
  schemaVersion: 4;
  event: RunEvent;
  checksum: string;
}

interface FenceRecord extends FencingAuthority {
  schemaVersion: 1;
}

const writeChains = new Map<string, Promise<unknown>>();

interface StorageSignature {
  activeSize: number;
  activeMtimeMs: number;
  manifestSize: number;
  manifestMtimeMs: number;
}

interface CachedInspection {
  signature: StorageSignature;
  inspection: RunEventLogInspection;
  projection: RunProjection | null;
  eventsById: Map<string, RunEvent>;
}

export class JsonlRunEventStore implements FencedRunEventStore {
  readonly directory: string;
  private readonly cache = new Map<string, CachedInspection>();

  constructor(options: { directory?: string } = {}) {
    this.directory = path.resolve(options.directory ?? ".manyhands/runs-v2");
  }

  eventLogPath(runId: string): string {
    return path.join(this.directory, `${safeName(runId)}.events.v2.jsonl`);
  }

  fencePath(runId: string): string {
    return path.join(this.directory, `${safeName(runId)}.fence.v2.json`);
  }

  async load(runId: string): Promise<RunEvent[]> {
    const inspection = await this.inspect(runId);
    if (inspection.status === "corrupt") {
      throw new CorruptRunEventLogError(runId, inspection.reason ?? "invalid durable record");
    }
    return inspection.events;
  }

  async inspect(runId: string): Promise<RunEventLogInspection> {
    let compacted;
    try {
      compacted = await readCompactedGeneration(this.directory, runId);
    } catch (error) {
      return { events: [], status: "corrupt", reason: `invalid compacted generation: ${errorMessage(error)}` };
    }
    let raw: string;
    try {
      raw = await readFile(this.eventLogPath(runId), "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return compacted === null
          ? { events: [], status: "ok" }
          : { events: compacted.events, status: "ok" };
      }
      throw error;
    }
    const baseEvents = compacted?.events ?? [];
    if (raw.length === 0) return { events: baseEvents, status: "ok" };

    const firstSequence = readFirstSequence(raw);
    const activeInspection = inspectRawLog(
      runId,
      raw,
      compacted !== null && firstSequence === 1 ? 1 : baseEvents.length + 1
    );
    if (activeInspection.status === "corrupt") {
      return {
        events: baseEvents,
        status: "corrupt",
        ...(activeInspection.reason === undefined ? {} : { reason: activeInspection.reason })
      };
    }
    const activeEvents = activeInspection.events.filter((event) => event.sequence > baseEvents.length);
    const events = [...baseEvents, ...activeEvents];
    try {
      if (events.length > 0) foldRunEvents(events);
    } catch (error) {
      return corrupt(events, `invalid domain history: ${errorMessage(error)}`);
    }
    return {
      events,
      status: activeInspection.status,
      ...(activeInspection.reason === undefined ? {} : { reason: activeInspection.reason })
    };
  }

  async claimAuthority(
    runId: string,
    operationId: string,
    minimumToken = 0
  ): Promise<FencingAuthority> {
    if (operationId.trim().length === 0) {
      throw new Error("An authority claim requires an operationId.");
    }
    if (!Number.isInteger(minimumToken) || minimumToken < 0) {
      throw new Error("minimumToken must be a non-negative integer.");
    }
    return this.withLock(runId, async () => {
      const current = await this.readFence(runId);
      const authority = {
        operationId,
        fencingToken: Math.max(current?.fencingToken ?? 0, minimumToken) + 1
      };
      await atomicWriteJson(
        this.fencePath(runId),
        { schemaVersion: 1, ...authority } satisfies FenceRecord
      );
      return authority;
    });
  }

  async advanceFence(runId: string, authority: FencingAuthority): Promise<void> {
    validateAuthority(authority);
    await this.withLock(runId, async () => {
      const current = await this.readFence(runId);
      if (current !== null) {
        const idempotent = current.operationId === authority.operationId && current.fencingToken === authority.fencingToken;
        if (idempotent) return;
        if (authority.fencingToken <= current.fencingToken) throw new StaleFencingTokenError(runId, authority);
      }
      await atomicWriteJson(this.fencePath(runId), { schemaVersion: 1, ...authority } satisfies FenceRecord);
    });
  }

  async assertAuthority(runId: string, authority: FencingAuthority): Promise<void> {
    validateAuthority(authority);
    const current = await this.readFence(runId);
    if (current === null || current.operationId !== authority.operationId || current.fencingToken !== authority.fencingToken) {
      throw new StaleFencingTokenError(runId, authority);
    }
  }

  async appendFenced(
    runId: string,
    expectedSequence: number,
    authority: FencingAuthority,
    inputs: RunEventInput[]
  ): Promise<RunEvent[]> {
    if (!Number.isInteger(expectedSequence) || expectedSequence < 0) throw new Error("expectedSequence must be a non-negative integer.");
    if (inputs.length === 0) return [];
    return this.withFencedWrite(runId, authority, async () => {
      const cached = await this.inspectCached(runId);
      const inspection = cached.inspection;
      if (inspection.status === "corrupt") throw new CorruptRunEventLogError(runId, inspection.reason ?? "invalid durable record");

      const duplicates = inputs.map((input) => cached.eventsById.get(input.eventId));
      if (duplicates.every((event) => event !== undefined)) {
        const events = duplicates as RunEvent[];
        events.forEach((event, index) => assertSameInput(event, inputs[index]!));
        return events;
      }
      if (duplicates.some((event) => event !== undefined)) throw new Error("An append batch cannot mix retried and new eventIds.");
      if (inspection.events.length !== expectedSequence) throw new SequenceConflictError(expectedSequence, inspection.events.length);

      const appended = inputs.map((input, index) => RunEventSchema.parse({
        ...input,
        runId,
        sequence: expectedSequence + index + 1
      }));
      const projection = cached.projection === null
        ? foldRunEvents(appended)
        : reduceRunEvents(cached.projection, appended);
      if (inspection.status === "degraded") {
        await truncateIncompleteTrailingLine(this.eventLogPath(runId));
      }
      await appendDurableEvents(this.eventLogPath(runId), appended);
      inspection.events.push(...appended);
      inspection.status = "ok";
      delete inspection.reason;
      for (const event of appended) cached.eventsById.set(event.eventId, event);
      const signature = await this.storageSignature(runId);
      this.cache.set(runId, {
        signature,
        inspection,
        projection: { ...projection, appliedEventIds: [] },
        eventsById: cached.eventsById
      });
      return appended;
    });
  }

  async withFencedWrite<T>(runId: string, authority: FencingAuthority, operation: () => Promise<T>): Promise<T> {
    return this.withLock(runId, async () => {
      await this.assertAuthority(runId, authority);
      const result = await operation();
      await this.assertAuthority(runId, authority);
      return result;
    });
  }

  bind(authority: FencingAuthority): RunEventJournalPort {
    return {
      load: (runId) => this.load(runId),
      append: (runId, expectedSequence, events) => this.appendFenced(runId, expectedSequence, authority, events)
    };
  }

  invalidateCache(runId: string): void {
    this.cache.delete(runId);
  }

  private async readFence(runId: string): Promise<FenceRecord | null> {
    try {
      const value = JSON.parse(await readFile(this.fencePath(runId), "utf8")) as Partial<FenceRecord>;
      if (value.schemaVersion !== 1 || typeof value.operationId !== "string" || !Number.isInteger(value.fencingToken) || (value.fencingToken ?? 0) <= 0) {
        throw new Error(`Invalid fencing record for run ${runId}.`);
      }
      return value as FenceRecord;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private async withLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const key = `${this.directory}:${runId}`;
    const previous = writeChains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const release = await acquireDurableLock(`${this.eventLogPath(runId)}.lock`);
      try {
        const result = await operation();
        // The heartbeat records ownership loss; renew once at the write
        // boundary so callers cannot report success after a lease takeover.
        await release.renew();
        return result;
      } finally {
        await release();
      }
    });
    writeChains.set(key, current);
    try {
      return await current;
    } finally {
      if (writeChains.get(key) === current) writeChains.delete(key);
    }
  }

  private async inspectCached(runId: string): Promise<CachedInspection> {
    const signature = await this.storageSignature(runId);
    const cached = this.cache.get(runId);
    if (cached !== undefined && sameSignature(cached.signature, signature)) return cached;
    const inspection = await this.inspect(runId);
    const folded = inspection.events.length === 0 ? null : foldRunEvents(inspection.events);
    const projection = folded === null ? null : { ...folded, appliedEventIds: [] };
    const next = {
      signature,
      inspection,
      projection,
      eventsById: new Map(inspection.events.map((event) => [event.eventId, event]))
    };
    this.cache.set(runId, next);
    return next;
  }

  private async storageSignature(runId: string): Promise<StorageSignature> {
    const active = await optionalStat(this.eventLogPath(runId));
    const manifest = await optionalStat(path.join(this.directory, `${safeName(runId)}.compaction-manifest.v1.json`));
    return {
      activeSize: active?.size ?? 0,
      activeMtimeMs: active?.mtimeMs ?? 0,
      manifestSize: manifest?.size ?? 0,
      manifestMtimeMs: manifest?.mtimeMs ?? 0
    };
  }
}

function inspectRawLog(runId: string, raw: string, startingSequence = 1): RunEventLogInspection {
  if (raw.length === 0) return { events: [], status: "ok" };
  const complete = raw.endsWith("\n");
  const lines = raw.split("\n");
  if (complete) lines.pop();
  const events: RunEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) return corrupt(events, `blank record at line ${index + 1}`);
    try {
      const rawEnvelope = JSON.parse(line) as { schemaVersion?: unknown; event?: unknown; checksum?: unknown };
      if (typeof rawEnvelope.schemaVersion !== "number" || rawEnvelope.event === undefined || typeof rawEnvelope.checksum !== "string") {
        return corrupt(events, `invalid envelope at line ${index + 1}`);
      }
      const event = RunEventSchema.parse(upcastEventToCurrent(rawEnvelope.schemaVersion, rawEnvelope.event));
      if (event.runId !== runId) return corrupt(events, `record at line ${index + 1} belongs to ${event.runId}`);
      const expectedSequence = startingSequence + index;
      if (event.sequence !== expectedSequence) return corrupt(events, `expected sequence ${expectedSequence}, received ${event.sequence}`);
      if (rawEnvelope.checksum !== checksumFor(event)) return corrupt(events, `checksum mismatch at line ${index + 1}`);
      events.push(event);
    } catch (error) {
      const isTrailingPartial = !complete && index === lines.length - 1;
      if (isTrailingPartial) return { events, status: "degraded", reason: "incomplete trailing record" };
      return corrupt(events, `invalid record at line ${index + 1}: ${errorMessage(error)}`);
    }
  }
  try {
    if (events.length > 0 && startingSequence === 1) foldRunEvents(events);
    return { events, status: "ok" };
  } catch (error) {
    return corrupt(events, `invalid domain history: ${errorMessage(error)}`);
  }
}

function corrupt(events: RunEvent[], reason: string): RunEventLogInspection {
  return { events, status: "corrupt", reason };
}

async function appendDurableEvents(filePath: string, events: readonly RunEvent[]): Promise<void> {
  const contents = events.map((event) => JSON.stringify({ schemaVersion: CURRENT_EVENT_SCHEMA_VERSION, event, checksum: checksumFor(event) } satisfies DurableEventEnvelope)).join("\n");
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendAndFlush(filePath, `${contents}\n`);
}

function checksumFor(event: RunEvent): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function assertSameInput(event: RunEvent, input: RunEventInput): void {
  const durableInput = { eventId: event.eventId, occurredAt: event.occurredAt, type: event.type, payload: event.payload };
  if (JSON.stringify(durableInput) !== JSON.stringify(input)) throw new Error(`Event id ${input.eventId} was already used with different content.`);
}

function validateAuthority(authority: FencingAuthority): void {
  if (authority.operationId.trim().length === 0 || !Number.isInteger(authority.fencingToken) || authority.fencingToken <= 0) {
    throw new Error("A fencing authority requires an operationId and a positive integer token.");
  }
}

function safeName(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFirstSequence(raw: string): number | null {
  try {
    const firstLine = raw.slice(0, raw.indexOf("\n") < 0 ? raw.length : raw.indexOf("\n"));
    const value = JSON.parse(firstLine) as { event?: { sequence?: unknown } };
    return typeof value.event?.sequence === "number" ? value.event.sequence : null;
  } catch {
    return null;
  }
}

async function truncateIncompleteTrailingLine(filePath: string): Promise<void> {
  const contents = await readFile(filePath);
  const lastNewline = contents.lastIndexOf(0x0a);
  await truncate(filePath, lastNewline < 0 ? 0 : lastNewline + 1);
}

async function appendAndFlush(filePath: string, contents: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(filePath, {
      flags: "a",
      encoding: "utf8",
      mode: 0o600
    });
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    stream.once("error", fail);
    stream.once("open", (descriptor) => {
      stream.write(contents, (writeError) => {
        if (writeError) {
          fail(writeError);
          stream.destroy();
          return;
        }
        const finish = (syncError?: NodeJS.ErrnoException | null) => {
          if (syncError) {
            fail(syncError);
            stream.destroy();
            return;
          }
          stream.end(() => {
            if (!settled) {
              settled = true;
              resolve();
            }
          });
        };
        if (durableWritesEnabled()) fsync(descriptor, finish);
        else finish();
      });
    });
  });
}

async function optionalStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function sameSignature(left: StorageSignature, right: StorageSignature): boolean {
  return left.activeSize === right.activeSize
    && left.activeMtimeMs === right.activeMtimeMs
    && left.manifestSize === right.manifestSize
    && left.manifestMtimeMs === right.manifestMtimeMs;
}

export { acquireDurableLock };
