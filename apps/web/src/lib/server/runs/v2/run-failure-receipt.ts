import { createHash, randomUUID } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson } from "@manyhands/run-store";
import { z } from "zod";

const RunFailureReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  receiptId: z.string().min(1),
  runId: z.string().min(1),
  operationId: z.string().min(1),
  fencingToken: z.number().int().nonnegative(),
  failedAt: z.string().datetime(),
  area: z.enum(["planning", "execution"]),
  reason: z.string().min(1),
  status: z.enum(["pending", "reconciled"]),
  recordingFailure: z.string().min(1).optional(),
  reconciledAt: z.string().datetime().optional()
}).strict();

export type RunFailureReceipt = z.infer<typeof RunFailureReceiptSchema>;

export class RunFailureReceiptPersistenceError extends Error {
  constructor(
    readonly receipt: RunFailureReceipt,
    readonly recordingFailure: unknown
  ) {
    super(`Run failed and its terminal event could not be recorded: ${messageOf(recordingFailure)}`);
    this.name = "RunFailureReceiptPersistenceError";
  }
}

export interface RunFailureReceiptStoreOptions {
  directory: string;
  clock?: () => string;
}

/**
 * Independent, append-preserving failure receipt for the narrow case where the
 * canonical event write itself fails. It is not a substitute for the journal:
 * a later lease must reconcile it into `run.failed` before executing again.
 */
export class RunFailureReceiptStore {
  private readonly directory: string;
  private readonly legacyDirectory: string;
  private readonly clock: () => string;

  constructor(options: RunFailureReceiptStoreOptions) {
    this.directory = path.join(options.directory, "run-failure-receipts");
    this.legacyDirectory = path.join(options.directory, "execution-failure-receipts");
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async create(input: {
    runId: string;
    operationId: string;
    fencingToken: number;
    area: RunFailureReceipt["area"];
    error: unknown;
  }): Promise<RunFailureReceipt> {
    const receiptId = createHash("sha256")
      .update(`${input.runId}\u0000${input.operationId}\u0000${input.fencingToken}\u0000${randomUUID()}`)
      .digest("hex");
    const receipt = RunFailureReceiptSchema.parse({
      schemaVersion: 1,
      receiptId,
      runId: input.runId,
      operationId: input.operationId,
      fencingToken: input.fencingToken,
      failedAt: this.clock(),
      area: input.area,
      reason: messageOf(input.error),
      status: "pending"
    });
    await atomicWriteJson(this.filePath(receipt), receipt);
    return receipt;
  }

  async listPending(runId: string, area?: RunFailureReceipt["area"]): Promise<RunFailureReceipt[]> {
    const receipts = await Promise.all([
      this.readReceipts(this.legacyDirectory),
      this.readReceipts(this.directory)
    ]);
    const uniqueReceipts = new Map(receipts.flat().map((receipt) => [receipt.receiptId, receipt]));
    return [...uniqueReceipts.values()]
      .filter((receipt) => receipt.runId === runId && receipt.status === "pending" && (area === undefined || receipt.area === area))
      .sort((left, right) => left.failedAt.localeCompare(right.failedAt) || left.receiptId.localeCompare(right.receiptId));
  }

  async recordRecordingFailure(receipt: RunFailureReceipt, error: unknown): Promise<RunFailureReceipt> {
    const next = RunFailureReceiptSchema.parse({ ...receipt, recordingFailure: messageOf(error), status: "pending" });
    await atomicWriteJson(this.filePath(next), next);
    await this.updateLegacyReceiptIfPresent(next);
    return next;
  }

  async markReconciled(receipt: RunFailureReceipt): Promise<RunFailureReceipt> {
    const next = RunFailureReceiptSchema.parse({ ...receipt, status: "reconciled", reconciledAt: this.clock() });
    await atomicWriteJson(this.filePath(next), next);
    await this.updateLegacyReceiptIfPresent(next);
    return next;
  }

  private async readReceipts(directory: string): Promise<RunFailureReceipt[]> {
    const files = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (isNotFound(error)) return [];
      throw error;
    });
    return Promise.all(files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => RunFailureReceiptSchema.parse(JSON.parse(await readFile(path.join(directory, entry.name), "utf8")))));
  }

  private async updateLegacyReceiptIfPresent(receipt: RunFailureReceipt): Promise<void> {
    const legacyPath = this.filePath(receipt, this.legacyDirectory);
    if (await fileExists(legacyPath)) {
      await atomicWriteJson(legacyPath, receipt);
    }
  }

  private filePath(
    receipt: Pick<RunFailureReceipt, "runId" | "receiptId">,
    directory = this.directory
  ): string {
    return path.join(directory, `${safeName(receipt.runId)}--${receipt.receiptId}.json`);
  }
}

export interface TerminalFailureRecorder {
  (receipt: RunFailureReceipt): Promise<void>;
}

export async function persistExecutionFailure(input: {
  store: RunFailureReceiptStore;
  runId: string;
  operationId: string;
  fencingToken: number;
  error: unknown;
  recordTerminalFailure: TerminalFailureRecorder;
}): Promise<RunFailureReceipt> {
  return persistRunFailure({ ...input, area: "execution" });
}

export async function persistRunFailure(input: {
  store: RunFailureReceiptStore;
  area: RunFailureReceipt["area"];
  runId: string;
  operationId: string;
  fencingToken: number;
  error: unknown;
  recordTerminalFailure: TerminalFailureRecorder;
}): Promise<RunFailureReceipt> {
  const receipt = await input.store.create(input);
  try {
    await input.recordTerminalFailure(receipt);
  } catch (recordingFailure) {
    await input.store.recordRecordingFailure(receipt, recordingFailure);
    throw new RunFailureReceiptPersistenceError(receipt, recordingFailure);
  }
  await input.store.markReconciled(receipt).catch(() => undefined);
  return receipt;
}

export async function reconcilePendingExecutionFailures(input: {
  store: RunFailureReceiptStore;
  runId: string;
  recordTerminalFailure: TerminalFailureRecorder;
}): Promise<{ reconciledReceiptIds: string[] }> {
  return reconcilePendingRunFailures({ ...input, area: "execution" });
}

export async function reconcilePendingRunFailures(input: {
  store: RunFailureReceiptStore;
  area: RunFailureReceipt["area"];
  runId: string;
  recordTerminalFailure: TerminalFailureRecorder;
}): Promise<{ reconciledReceiptIds: string[] }> {
  const pending = await input.store.listPending(input.runId, input.area);
  const reconciledReceiptIds: string[] = [];
  for (const receipt of pending) {
    try {
      await input.recordTerminalFailure(receipt);
    } catch (recordingFailure) {
      await input.store.recordRecordingFailure(receipt, recordingFailure);
      throw new RunFailureReceiptPersistenceError(receipt, recordingFailure);
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

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, (error: unknown) => {
    if (isNotFound(error)) return false;
    throw error;
  });
}
