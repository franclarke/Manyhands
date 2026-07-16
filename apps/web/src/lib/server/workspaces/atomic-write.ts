import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

export interface AtomicWriteOptions {
  /** Defaults to true; set MANYHANDS_FSYNC=0 only for disposable development data. */
  fsync?: boolean;
  /** Injectable only for deterministic filesystem-fault regressions. */
  renameFile?: typeof rename;
}

export function durableWritesEnabled(): boolean {
  return process.env.MANYHANDS_FSYNC !== "0";
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const fsync = options.fsync ?? durableWritesEnabled();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(payload, { encoding: "utf8" });
    if (fsync) await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithTransientRetry(tempPath, filePath, options.renameFile ?? rename);
    if (fsync) await syncDirectoryBestEffort(directory);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

const TRANSIENT_RENAME_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400] as const;

/**
 * Windows can briefly deny an atomic replacement while an antivirus scanner,
 * file indexer, or concurrent reader still owns a handle to the destination.
 * The temp file is already closed and fsynced at this point, so retrying the
 * same rename preserves atomicity and avoids turning a transient sharing
 * violation into a lost durable state transition.
 */
async function renameWithTransientRetry(
  source: string,
  destination: string,
  renameFile: typeof rename
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        code === undefined ||
        !TRANSIENT_RENAME_CODES.has(code) ||
        attempt >= RENAME_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]));
    }
  }
}

/** Directory fsync is unsupported on Windows; the file itself is still synced. */
async function syncDirectoryBestEffort(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r").catch(() => undefined);
  if (handle === undefined) return;
  try {
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
}
