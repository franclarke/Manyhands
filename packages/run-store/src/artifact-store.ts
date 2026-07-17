import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AdoptedArtifactSchema, type AdoptedArtifact } from "@manyhands/run-coordinator";

export class ImmutableArtifactConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ImmutableArtifactConflictError"; }
}

export class JsonlArtifactStore {
  private readonly directory: string;
  private readonly chains = new Map<string, Promise<unknown>>();
  constructor(options: { directory?: string } = {}) { this.directory = path.resolve(options.directory ?? ".manyhands/runs-v2"); }

  async list(runId: string): Promise<AdoptedArtifact[]> { return readRecords(this.filePath(runId), AdoptedArtifactSchema.parse); }

  async adopt(raw: AdoptedArtifact): Promise<AdoptedArtifact> {
    const artifact = AdoptedArtifactSchema.parse(raw);
    return this.withLock(artifact.runId, async () => {
      const current = await this.list(artifact.runId);
      const existing = current.find((item) => item.artifactId === artifact.artifactId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) === JSON.stringify(artifact)) return existing;
        throw new ImmutableArtifactConflictError(`Artifact ${artifact.artifactId} is immutable and already has different content.`);
      }
      await writeRecords(this.filePath(artifact.runId), [...current, artifact]);
      return artifact;
    });
  }

  private filePath(runId: string): string { return path.join(this.directory, `${safe(runId)}.artifacts.v2.jsonl`); }
  private withLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.chains.set(runId, current);
    return current.finally(() => { if (this.chains.get(runId) === current) this.chains.delete(runId); });
  }
}

async function readRecords<T>(filePath: string, parse: (value: unknown) => T): Promise<T[]> {
  try { return (await readFile(filePath, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => parse(JSON.parse(line))); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
}
async function writeRecords(filePath: string, records: readonly unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${records.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  await rename(temporary, filePath);
}
function safe(value: string): string { return value.replace(/[^A-Za-z0-9._-]/gu, "_"); }
