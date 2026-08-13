import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  RunEventSchema,
  type RunEvent,
  type RunProjection
} from "@manyhands/run-coordinator";
import { atomicWriteFile, atomicWriteJson } from "./durable-file.js";
import type { FencingAuthority } from "./event-store.js";
import type { JsonlRunEventStore } from "./jsonl-event-store.js";
import { foldRunEvents } from "./projection-fold.js";

const DEFAULT_COMPACTION_THRESHOLD = 1_000;

interface GenerationSnapshotBase {
  schemaVersion: 1;
  generation: number;
  runId: string;
  eventSequence: number;
  lastEventId: string;
  events: RunEvent[];
  projection: RunProjection;
}

interface GenerationSnapshot extends GenerationSnapshotBase {
  checksum: string;
}

interface CompactionManifestBase {
  schemaVersion: 1;
  runId: string;
  generation: number;
  snapshotFile: string;
  eventSequence: number;
  lastEventId: string;
}

interface CompactionManifest extends CompactionManifestBase {
  checksum: string;
}

export interface CompactedGeneration {
  generation: number;
  events: RunEvent[];
  projection: RunProjection;
  eventSequence: number;
  lastEventId: string;
}

export interface CompactionResult extends CompactedGeneration {
  snapshotPath: string;
  manifestPath: string;
  compactedEventCount: number;
}

export class EventStoreCompactor {
  readonly store: JsonlRunEventStore;
  readonly threshold: number;

  constructor(store: JsonlRunEventStore, options?: { threshold?: number });
  constructor(options: { store: JsonlRunEventStore; threshold?: number });
  constructor(
    storeOrOptions: JsonlRunEventStore | { store: JsonlRunEventStore; threshold?: number },
    options: { threshold?: number } = {}
  ) {
    if ("store" in storeOrOptions) {
      this.store = storeOrOptions.store;
      this.threshold = storeOrOptions.threshold ?? DEFAULT_COMPACTION_THRESHOLD;
    } else {
      this.store = storeOrOptions;
      this.threshold = options.threshold ?? DEFAULT_COMPACTION_THRESHOLD;
    }
    if (!Number.isInteger(this.threshold) || this.threshold < 1) {
      throw new TypeError("Compaction threshold must be a positive integer.");
    }
  }

  async compactIfNeeded(
    runId: string,
    authority: FencingAuthority
  ): Promise<CompactionResult | null> {
    const [events, previous] = await Promise.all([
      this.store.load(runId),
      readCompactedGeneration(this.store.directory, runId)
    ]);
    if (events.length - (previous?.events.length ?? 0) <= this.threshold) {
      return null;
    }
    return this.compact(runId, authority);
  }

  async compact(runId: string, authority: FencingAuthority): Promise<CompactionResult | null> {
    return this.store.withFencedWrite(runId, authority, async () => {
      const events = await this.store.load(runId);
      if (events.length === 0) return null;
      const previous = await readCompactedGeneration(this.store.directory, runId);
      const activeEventCount = events.length - (previous?.events.length ?? 0);
      if (activeEventCount === 0) return null;
      const generation = (previous?.generation ?? 0) + 1;
      const last = events.at(-1)!;
      const snapshotBase: GenerationSnapshotBase = {
        schemaVersion: 1,
        generation,
        runId,
        eventSequence: last.sequence,
        lastEventId: last.eventId,
        events,
        projection: foldRunEvents(events)
      };
      const snapshot: GenerationSnapshot = {
        ...snapshotBase,
        checksum: checksum(snapshotBase)
      };
      const snapshotPath = generationSnapshotPath(this.store.directory, runId, generation);
      await atomicWriteJson(snapshotPath, snapshot);

      const manifestBase: CompactionManifestBase = {
        schemaVersion: 1,
        runId,
        generation,
        snapshotFile: path.basename(snapshotPath),
        eventSequence: last.sequence,
        lastEventId: last.eventId
      };
      await atomicWriteJson(compactionManifestPath(this.store.directory, runId), {
        ...manifestBase,
        checksum: checksum(manifestBase)
      } satisfies CompactionManifest);

      // Publishing the manifest before clearing the active file is deliberate:
      // a crash may temporarily leave duplicate records, but never lose history.
      await atomicWriteFile(this.store.eventLogPath(runId), "");
      this.store.invalidateCache(runId);

      return {
        generation,
        events,
        projection: snapshot.projection,
        eventSequence: last.sequence,
        lastEventId: last.eventId,
        compactedEventCount: activeEventCount,
        snapshotPath,
        manifestPath: compactionManifestPath(this.store.directory, runId)
      };
    });
  }
}

export async function readCompactedGeneration(
  directory: string,
  runId: string
): Promise<CompactedGeneration | null> {
  let manifestContents: string;
  try {
    manifestContents = await readFile(compactionManifestPath(directory, runId), "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const manifest = parseManifest(manifestContents, runId);
  return readGenerationSnapshot(path.join(path.resolve(directory), manifest.snapshotFile), runId);
}

export async function findLatestValidGeneration(
  directory: string,
  runId: string
): Promise<CompactedGeneration | null> {
  const resolved = path.resolve(directory);
  let files: string[];
  try {
    files = await readdir(resolved);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const prefix = `${safeName(runId)}.generation-`;
  const candidates = files
    .map((file) => ({ file, match: new RegExp(`^${escapeRegExp(prefix)}(\\d+)\\.snapshot\\.json$`, "u").exec(file) }))
    .filter((candidate): candidate is { file: string; match: RegExpExecArray } => candidate.match !== null)
    .sort((left, right) => Number(right.match[1]) - Number(left.match[1]));
  for (const candidate of candidates) {
    try {
      return await readGenerationSnapshot(path.join(resolved, candidate.file), runId);
    } catch {
      // A newer generation may have been interrupted. Continue to the last
      // completely checksummed generation.
    }
  }
  return null;
}

export async function restoreCompactionManifest(
  directory: string,
  runId: string,
  generation: CompactedGeneration
): Promise<string> {
  const snapshotPath = generationSnapshotPath(directory, runId, generation.generation);
  const manifestBase: CompactionManifestBase = {
    schemaVersion: 1,
    runId,
    generation: generation.generation,
    snapshotFile: path.basename(snapshotPath),
    eventSequence: generation.eventSequence,
    lastEventId: generation.lastEventId
  };
  const manifestPath = compactionManifestPath(directory, runId);
  await atomicWriteJson(manifestPath, {
    ...manifestBase,
    checksum: checksum(manifestBase)
  } satisfies CompactionManifest);
  return manifestPath;
}

export function compactionManifestPath(directory: string, runId: string): string {
  return path.join(path.resolve(directory), `${safeName(runId)}.compaction-manifest.v1.json`);
}

export function generationSnapshotPath(directory: string, runId: string, generation: number): string {
  return path.join(path.resolve(directory), `${safeName(runId)}.generation-${generation}.snapshot.json`);
}

async function readGenerationSnapshot(filePath: string, runId: string): Promise<CompactedGeneration> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as Partial<GenerationSnapshot>;
  if (
    raw.schemaVersion !== 1
    || raw.runId !== runId
    || !Number.isInteger(raw.generation)
    || (raw.generation ?? 0) < 1
    || !Number.isInteger(raw.eventSequence)
    || typeof raw.lastEventId !== "string"
    || !Array.isArray(raw.events)
    || raw.projection === undefined
    || typeof raw.checksum !== "string"
  ) {
    throw new Error(`Invalid compacted generation ${filePath}.`);
  }
  const events = raw.events.map((event) => RunEventSchema.parse(event));
  const base: GenerationSnapshotBase = {
    schemaVersion: 1,
    generation: raw.generation!,
    runId,
    eventSequence: raw.eventSequence!,
    lastEventId: raw.lastEventId,
    events,
    projection: raw.projection as RunProjection
  };
  if (checksum(base) !== raw.checksum) throw new Error(`Checksum mismatch in ${filePath}.`);
  if (events.length !== base.eventSequence || events.at(-1)?.eventId !== base.lastEventId) {
    throw new Error(`Invalid event cursor in ${filePath}.`);
  }
  foldRunEvents(events);
  return {
    generation: base.generation,
    events,
    projection: base.projection,
    eventSequence: base.eventSequence,
    lastEventId: base.lastEventId
  };
}

function parseManifest(contents: string, runId: string): CompactionManifest {
  const raw = JSON.parse(contents) as Partial<CompactionManifest>;
  if (
    raw.schemaVersion !== 1
    || raw.runId !== runId
    || !Number.isInteger(raw.generation)
    || typeof raw.snapshotFile !== "string"
    || path.basename(raw.snapshotFile) !== raw.snapshotFile
    || !Number.isInteger(raw.eventSequence)
    || typeof raw.lastEventId !== "string"
    || typeof raw.checksum !== "string"
  ) {
    throw new Error(`Invalid compaction manifest for run ${runId}.`);
  }
  const base: CompactionManifestBase = {
    schemaVersion: 1,
    runId,
    generation: raw.generation!,
    snapshotFile: raw.snapshotFile,
    eventSequence: raw.eventSequence!,
    lastEventId: raw.lastEventId
  };
  if (checksum(base) !== raw.checksum) throw new Error(`Compaction manifest checksum mismatch for run ${runId}.`);
  return raw as CompactionManifest;
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeName(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
