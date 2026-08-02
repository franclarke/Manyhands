import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson } from "@manyhands/run-store";
import { z } from "zod";

const ExecutionFailureReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  receiptId: z.string().min(1),
  runId: z.string().min(1),
  operationId: z.string().min(1),
  fencingToken: z.number().int().nonnegative(),
  failedAt: z.string().datetime(),
  reason: z.string().min(1),
  status: z.enum(["pending", "reconciled"]),
  recordingFailure: z.string().min(1).optional(),
  reconciledAt: z.string().datetime().optional()
}).strict();

export type ExecutionFailureReceipt = z.infer<typeof ExecutionFailureReceiptSchema>;

export class ExecutionFailureReceiptPersistenceError extends Error {
  constructor(
    readonly receipt: ExecutionFailureReceipt,
    readonly recordingFailure: unknown
  ) {
    super(`Execution failed and its terminal event could not be recorded: ${messageOf(recordingFailure)}`);
    this.name = "ExecutionFailureReceiptPersistenceError";
  }
}

export interface ExecutionFailureReceiptStoreOptions {
  directory: string;
  clock?: () => string;
}

/**
 * Independent, append-preserving failure receipt for the narrow case where the
 * canonical event write itself fails. It is not a substitute for the journal:
 * a later lease must reconcile it into `run.failed` before executing again.
 */
export class ExecutionFailureReceiptStore {
  private readonly directory: string;
  private readonly clock: () => string;

  constructor(options: ExecutionFailureReceiptStoreOptions) {
    this.directory = path.join(options.directory, "execution-failure-receipts");
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async create(input: {
    runId: string;
    operationId: string;
    fencingToken: number;
    error: unknown;
  }): Promise<ExecutionFailureReceipt> {
    const receiptId = createHash("sha256")
      .update(`${input.runId}\u0000${input.operationId}\u0000${input.fencingToken}\u0000${randomUUID()}`)
      .digest("hex");
    const receipt = ExecutionFailureReceiptSchema.parse({
      schemaVersion: 1,
      receiptId,
      runId: input.runId,
      operationId: input.operationId,
      fencingToken: input.fencingToken,
      failedAt: this.clock(),
      reason: messageOf(input.error),
      status: "pending"
    });
    await atomicWriteJson(this.filePath(receipt), receipt);
    return receipt;
  }

  async listPending(runId: string): Promise<ExecutionFailureReceipt[]> {
    const files = await readdir(this.directory, { withFileTypes: true }).catch((error: unknown) => {
      if (isNotFound(error)) return [];
      throw error;
    });
    const receipts = await Promise.all(files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => ExecutionFailureReceiptSchema.parse(JSON.parse(await readFile(path.join(this.directory, entry.name), "utf8")))));
    return receipts
      .filter((receipt) => receipt.runId === runId && receipt.status === "pending")
      .sort((left, right) => left.failedAt.localeCompare(right.failedAt) || left.receiptId.localeCompare(right.receiptId));
  }

  async recordRecordingFailure(receipt: ExecutionFailureReceipt, error: unknown): Promise<ExecutionFailureReceipt> {
    const next = ExecutionFailureReceiptSchema.parse({ ...receipt, recordingFailure: messageOf(error), status: "pending" });
    await atomicWriteJson(this.filePath(next), next);
    return next;
  }

  async markReconciled(receipt: ExecutionFailureReceipt): Promise<ExecutionFailureReceipt> {
    const next = ExecutionFailureReceiptSchema.parse({ ...receipt, status: "reconciled", reconciledAt: this.clock() });
    await atomicWriteJson(this.filePath(next), next);
    return next;
  }

  private filePath(receipt: Pick<ExecutionFailureReceipt, "runId" | "receiptId">): string {
    return path.join(this.directory, `${safeName(receipt.runId)}--${receipt.receiptId}.json`);
  }
}

export interface TerminalFailureRecorder {
  (receipt: ExecutionFailureReceipt): Promise<void>;
}

export async function persistExecutionFailure(input: {
  store: ExecutionFailureReceiptStore;
  runId: string;
  operationId: string;
  fencingToken: number;
  error: unknown;
  recordTerminalFailure: TerminalFailureRecorder;
}): Promise<ExecutionFailureReceipt> {
  const receipt = await input.store.create(input);
  try {
    await input.recordTerminalFailure(receipt);
  } catch (recordingFailure) {
    await input.store.recordRecordingFailure(receipt, recordingFailure);
    throw new ExecutionFailureReceiptPersistenceError(receipt, recordingFailure);
  }
  await input.store.markReconciled(receipt).catch(() => undefined);
  return receipt;
}

export async function reconcilePendingExecutionFailures(input: {
  store: ExecutionFailureReceiptStore;
  runId: string;
  recordTerminalFailure: TerminalFailureRecorder;
}): Promise<{ reconciledReceiptIds: string[] }> {
  const pending = await input.store.listPending(input.runId);
  const reconciledReceiptIds: string[] = [];
  for (const receipt of pending) {
    try {
      await input.recordTerminalFailure(receipt);
    } catch (recordingFailure) {
      await input.store.recordRecordingFailure(receipt, recordingFailure);
      throw new ExecutionFailureReceiptPersistenceError(receipt, recordingFailure);
    }
    await input.store.markReconciled(receipt);
    reconciledReceiptIds.push(receipt.receiptId);
  }
  return { reconciledReceiptIds };
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
