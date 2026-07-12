import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type IntegrationOperationState =
  | "prepared"
  | "child_pending"
  | "cherry_pick_started"
  | "child_applied"
  | "conflict_detected"
  | "repair_started"
  | "repair_finished"
  | "validation_started"
  | "validation_finished"
  | "integration_commit_recorded"
  | "result_persisted"
  | "completed"
  | "gated"
  | "failed"
  | "cancelled";

export interface IntegrationOperationChild {
  taskId: string;
  commitSha: string;
  state: "pending" | "started" | "applied" | "conflict" | "repaired";
  resultSha?: string;
}

export interface IntegrationOperation {
  schemaVersion: 1;
  integrationOperationId: string;
  runId: string;
  parentNodeId: string;
  attemptId?: string;
  operationId?: string;
  fencingToken?: number;
  worktreePath: string;
  baseSha: string;
  children: IntegrationOperationChild[];
  state: IntegrationOperationState;
  currentChildId?: string;
  finalSha?: string;
  disposition?: string;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationOperationJournal {
  open(input: Omit<IntegrationOperation, "schemaVersion" | "integrationOperationId" | "state" | "createdAt" | "updatedAt">): Promise<IntegrationOperation>;
  update(operation: IntegrationOperation, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation>;
}

/** Small, durable operation journal. It deliberately captures Git evidence, not executor output. */
export class JsonIntegrationOperationJournal implements IntegrationOperationJournal {
  constructor(private readonly directory: string, private readonly now: () => string = () => new Date().toISOString()) {}

  async open(input: Omit<IntegrationOperation, "schemaVersion" | "integrationOperationId" | "state" | "createdAt" | "updatedAt">): Promise<IntegrationOperation> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(input.runId, input.parentNodeId, input.attemptId);
    const existing = await this.read(path);
    if (existing !== undefined) {
      if (JSON.stringify(existing.children.map(({ taskId, commitSha }) => ({ taskId, commitSha }))) !== JSON.stringify(input.children.map(({ taskId, commitSha }) => ({ taskId, commitSha })))) {
        throw new Error("Integration operation child list changed during resume.");
      }
      return existing;
    }
    const timestamp = this.now();
    const operation: IntegrationOperation = { ...input, schemaVersion: 1, integrationOperationId: randomUUID(), state: "prepared", createdAt: timestamp, updatedAt: timestamp };
    await this.write(path, operation);
    return operation;
  }

  async update(operation: IntegrationOperation, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation> {
    const next: IntegrationOperation = { ...operation, ...patch, updatedAt: this.now() };
    await this.write(this.pathFor(next.runId, next.parentNodeId, next.attemptId), next);
    return next;
  }

  private pathFor(runId: string, parentNodeId: string, attemptId?: string): string {
    return join(this.directory, `${runId}-${parentNodeId}-${attemptId ?? "legacy"}.json`);
  }
  private async read(path: string): Promise<IntegrationOperation | undefined> {
    try { return JSON.parse(await readFile(path, "utf8")) as IntegrationOperation; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  private async write(path: string, value: IntegrationOperation): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value), "utf8");
    await rename(temp, path);
  }
}
