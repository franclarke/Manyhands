import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { foldRun, type RunProjection } from "@manyhands/run-coordinator";
import type { FencingAuthority } from "./event-store.js";
import type { JsonlRunEventStore } from "./jsonl-event-store.js";

interface SnapshotEnvelope {
  schemaVersion: 2;
  runId: string;
  eventSequence: number;
  lastEventId: string;
  operationId: string;
  fencingToken: number;
  projection: unknown;
  checksum: string;
}

export class RunSnapshotStore {
  readonly directory: string;
  private readonly events: JsonlRunEventStore;

  constructor(options: { directory?: string; events: JsonlRunEventStore }) {
    this.directory = path.resolve(options.directory ?? ".manyhands/runs-v2");
    this.events = options.events;
  }

  snapshotPath(runId: string): string {
    return path.join(this.directory, `${runId.replace(/[^A-Za-z0-9._-]/gu, "_")}.snapshot.v2.json`);
  }

  async write(
    runId: string,
    authority: FencingAuthority,
    projection: unknown,
    eventSequence: number,
    lastEventId: string
  ): Promise<void> {
    await this.events.withFencedWrite(runId, authority, async () => {
      const base = { schemaVersion: 2 as const, runId, eventSequence, lastEventId, operationId: authority.operationId, fencingToken: authority.fencingToken, projection };
      const envelope: SnapshotEnvelope = { ...base, checksum: checksum(base) };
      await atomicWrite(this.snapshotPath(runId), `${JSON.stringify(envelope, null, 2)}\n`);
    });
  }

  async loadOrRebuild(runId: string, authority: FencingAuthority): Promise<RunProjection> {
    await this.events.assertAuthority(runId, authority);
    const events = await this.events.load(runId);
    if (events.length === 0) throw new Error(`Cannot build snapshot for run ${runId} without events.`);
    const last = events.at(-1)!;
    const cached = await this.read(runId);
    if (cached !== null && cached.operationId === authority.operationId && cached.fencingToken === authority.fencingToken && cached.eventSequence === last.sequence && cached.lastEventId === last.eventId) {
      return cached.projection as RunProjection;
    }
    const projection = foldRun(events);
    await this.write(runId, authority, projection, last.sequence, last.eventId);
    return projection;
  }

  private async read(runId: string): Promise<SnapshotEnvelope | null> {
    let contents: string;
    try {
      contents = await readFile(this.snapshotPath(runId), "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    try {
      const raw = JSON.parse(contents) as Partial<SnapshotEnvelope>;
      if (raw.schemaVersion !== 2 || raw.runId !== runId || typeof raw.eventSequence !== "number" || typeof raw.lastEventId !== "string" || typeof raw.operationId !== "string" || typeof raw.fencingToken !== "number" || raw.projection === undefined || typeof raw.checksum !== "string") return null;
      const base = { schemaVersion: 2 as const, runId: raw.runId, eventSequence: raw.eventSequence, lastEventId: raw.lastEventId, operationId: raw.operationId, fencingToken: raw.fencingToken, projection: raw.projection };
      return raw.checksum === checksum(base) ? raw as SnapshotEnvelope : null;
    } catch {
      return null;
    }
  }
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, filePath);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
