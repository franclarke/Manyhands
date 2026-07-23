import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RENAME_RETRIES = 5;
const RETRYABLE_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

export interface AtomicWriteOptions {
  fsync?: boolean;
  renameFile?: (source: string, destination: string) => Promise<void>;
  removeFile?: (filePath: string) => Promise<void>;
  delay?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxRenameAttempts?: number;
}

export function durableWritesEnabled(): boolean {
  return process.env.MANYHANDS_FSYNC !== "0";
}

export async function atomicWriteFile(
  filePath: string,
  contents: string | Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  const temporary = `${target}.tmp.${process.pid}.${randomUUID()}`;
  const shouldFsync = options.fsync ?? durableWritesEnabled();
  const renameFile = options.renameFile ?? rename;
  const removeFile = options.removeFile ?? (async (candidate) => rm(candidate, { force: true }));
  const wait = options.delay ?? delay;
  const random = options.random ?? Math.random;
  const maxAttempts = options.maxRenameAttempts ?? DEFAULT_RENAME_RETRIES;

  await mkdir(directory, { recursive: true });

  let published = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents);
      if (shouldFsync) await handle.sync();
    } finally {
      await handle.close();
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await renameFile(temporary, target);
        published = true;
        break;
      } catch (error) {
        if (!isRetryableRename(error) || attempt === maxAttempts - 1) throw error;
        const exponential = 10 * 2 ** attempt;
        const jitter = Math.floor(random() * Math.max(1, exponential));
        await wait(exponential + jitter);
      }
    }

    if (!published) throw new Error(`Atomic write failed to publish ${target}.`);
    if (shouldFsync) await syncDirectory(directory);
  } finally {
    if (!published) {
      try {
        await removeFile(temporary);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
  }
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {}
): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Windows does not consistently allow opening directories. The file itself
    // has already been flushed, so only ignore platform-specific directory errors.
    if (process.platform !== "win32" || !isDirectorySyncUnsupported(error)) throw error;
  } finally {
    await handle?.close();
  }
}

function isRetryableRename(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && RETRYABLE_RENAME_CODES.has(String(error.code));
}

function isDirectorySyncUnsupported(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ["EACCES", "EBADF", "EINVAL", "EPERM"].includes(String(error.code));
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
