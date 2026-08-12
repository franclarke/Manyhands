import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  PhysicalEffectReceiptSchema,
  canonicalJson,
  validatePhysicalEffectReceiptIdentity,
  type DigestHasher,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import { durableWritesEnabled } from "./durable-file.js";

const RECEIPT_FILE_SUFFIX = ".receipt.json";

export class PhysicalEffectReceiptCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhysicalEffectReceiptCorruptionError";
  }
}

export interface PhysicalEffectReceiptPublishContext {
  receipt: Readonly<PhysicalEffectReceipt>;
  temporaryPath: string;
  targetPath: string;
}

export interface FilePhysicalEffectReceiptStoreOptions {
  directory?: string;
  hasher: DigestHasher;
  fsync?: boolean;
  removeTemporaryFile?: (filePath: string) => Promise<void>;
  beforePublish?: (
    context: PhysicalEffectReceiptPublishContext
  ) => void | Promise<void>;
}

/**
 * Persists each physical observation as a separate immutable file.
 *
 * A fully written and flushed temporary file is published with an exclusive
 * hard link. Unlike rename-based atomic writes, the publish step cannot replace
 * a receipt that another daemon or process already created.
 */
export class FilePhysicalEffectReceiptStore {
  private readonly directory: string;
  private readonly hasher: DigestHasher;
  private readonly shouldFsync: boolean;
  private readonly removeTemporaryFile: (filePath: string) => Promise<void>;
  private readonly beforePublish?: FilePhysicalEffectReceiptStoreOptions["beforePublish"];

  constructor(options: FilePhysicalEffectReceiptStoreOptions) {
    this.directory = path.resolve(options.directory ?? ".manyhands/runs-v2/effect-receipts");
    this.hasher = options.hasher;
    this.shouldFsync = options.fsync ?? durableWritesEnabled();
    this.removeTemporaryFile = options.removeTemporaryFile
      ?? (async (filePath) => rm(filePath, { force: true }));
    this.beforePublish = options.beforePublish;
  }

  async put(input: unknown): Promise<PhysicalEffectReceipt> {
    const receipt = this.parseAndValidate(input, "receipt being published");
    const targetPath = this.receiptPath(receipt.receiptId);
    const existing = await this.readPathIfPresent(targetPath, receipt.receiptId);
    if (existing !== undefined) return assertIdentical(existing, receipt);

    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${targetPath}.tmp.${process.pid}.${randomUUID()}`;
    let temporaryCreated = false;

    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(`${canonicalJson(receipt)}\n`, "utf8");
        if (this.shouldFsync) await handle.sync();
      } finally {
        await handle.close();
      }

      await this.beforePublish?.({ receipt, temporaryPath, targetPath });

      try {
        // Both paths are in the same directory, so the link publishes the exact
        // flushed file and fails with EEXIST instead of overwriting a winner.
        await link(temporaryPath, targetPath);
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        const winner = await this.readPathIfPresent(targetPath, receipt.receiptId);
        if (winner === undefined) {
          throw new PhysicalEffectReceiptCorruptionError(
            `Receipt ${receipt.receiptId} won publication but cannot be read.`
          );
        }
        return assertIdentical(winner, receipt);
      }

      if (this.shouldFsync) await syncDirectory(this.directory);
      return receipt;
    } finally {
      if (temporaryCreated) {
        await removeTemporaryBestEffort(temporaryPath, this.removeTemporaryFile);
      }
    }
  }

  async get(receiptId: string): Promise<PhysicalEffectReceipt | undefined> {
    if (receiptId.length === 0) throw new TypeError("receiptId must not be empty.");
    return this.readPathIfPresent(this.receiptPath(receiptId), receiptId);
  }

  async list(): Promise<PhysicalEffectReceipt[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const receipts: PhysicalEffectReceipt[] = [];
    const receiptIds = new Set<string>();
    for (const entry of entries.filter((name) => name.endsWith(RECEIPT_FILE_SUFFIX)).sort()) {
      const receipt = await this.readPath(path.join(this.directory, entry));
      if (entry !== receiptFileName(receipt.receiptId)) {
        throw new PhysicalEffectReceiptCorruptionError(
          `Receipt ${receipt.receiptId} is stored under a filename that does not match its identity.`
        );
      }
      if (receiptIds.has(receipt.receiptId)) {
        throw new PhysicalEffectReceiptCorruptionError(
          `Receipt ${receipt.receiptId} appears more than once in the immutable store.`
        );
      }
      receiptIds.add(receipt.receiptId);
      receipts.push(receipt);
    }

    return receipts.sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  }

  private receiptPath(receiptId: string): string {
    return path.join(this.directory, receiptFileName(receiptId));
  }

  private async readPathIfPresent(
    filePath: string,
    expectedReceiptId: string
  ): Promise<PhysicalEffectReceipt | undefined> {
    try {
      const receipt = await this.readPath(filePath);
      if (receipt.receiptId !== expectedReceiptId) {
        throw new PhysicalEffectReceiptCorruptionError(
          `Receipt file for ${expectedReceiptId} contains identity ${receipt.receiptId}.`
        );
      }
      return receipt;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async readPath(filePath: string): Promise<PhysicalEffectReceipt> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (isNotFound(error)) throw error;
      throw new PhysicalEffectReceiptCorruptionError(
        `Physical effect receipt ${filePath} is not complete JSON.`
      );
    }
    return this.parseAndValidate(parsedJson, `persisted receipt ${filePath}`);
  }

  private parseAndValidate(input: unknown, label: string): PhysicalEffectReceipt {
    const parsed = PhysicalEffectReceiptSchema.safeParse(input);
    if (!parsed.success) {
      throw new PhysicalEffectReceiptCorruptionError(
        `${label} is schema-invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`
      );
    }

    const identity = validatePhysicalEffectReceiptIdentity(parsed.data, this.hasher);
    if (!identity.ok) {
      throw new PhysicalEffectReceiptCorruptionError(
        `${label} has invalid canonical identity: ${identity.issues
          .map((issue) => issue.message)
          .join("; ")}`
      );
    }
    return parsed.data;
  }
}

function receiptFileName(receiptId: string): string {
  // The receipt id itself commonly contains a colon and may contain any
  // non-empty schema-valid text. Hashing the complete id yields a stable,
  // Windows-safe filename without the collisions caused by character replacement.
  return `${createHash("sha256").update(receiptId, "utf8").digest("hex")}${RECEIPT_FILE_SUFFIX}`;
}

function assertIdentical(
  existing: PhysicalEffectReceipt,
  candidate: PhysicalEffectReceipt
): PhysicalEffectReceipt {
  if (canonicalJson(existing) === canonicalJson(candidate)) return existing;
  throw new PhysicalEffectReceiptCorruptionError(
    `Receipt ${candidate.receiptId} is immutable and already identifies different content.`
  );
}

async function removeTemporaryBestEffort(
  temporaryPath: string,
  removeFile: (filePath: string) => Promise<void>
): Promise<void> {
  try {
    await removeFile(temporaryPath);
  } catch {
    // A temporary-link cleanup failure cannot revoke a receipt already
    // published, nor replace the primary error that prevented publication.
    // Stale *.tmp.* files are never read as receipts and may be reclaimed later.
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (process.platform !== "win32" || !isDirectorySyncUnsupported(error)) throw error;
  } finally {
    await handle?.close();
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isDirectorySyncUnsupported(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ["EACCES", "EBADF", "EINVAL", "EPERM"].includes(String(error.code));
}
