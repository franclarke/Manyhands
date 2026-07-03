import { rm } from "node:fs/promises";

/**
 * Recursively removes a directory, retrying on transient Windows filesystem
 * locks. After `git init` + commit, Windows can briefly hold handles on the
 * `.git` tree (the OS releasing handles, antivirus/indexer scanning), so a
 * plain `rm -rf` races and throws EBUSY/ENOTEMPTY/EPERM/EACCES. `force: true`
 * makes a missing path a no-op, so this is safe as both a pre-clean and a
 * teardown. Non-transient errors surface immediately.
 */
const TRANSIENT_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"]);

export interface RmWithRetryOptions {
  /** Extra attempts after the first try. Default 5. */
  retries?: number;
  /** Base backoff in ms; grows linearly per attempt. Default 100. */
  delayMs?: number;
}

export async function rmWithRetry(
  target: string,
  options: RmWithRetryOptions = {}
): Promise<void> {
  const retries = options.retries ?? 5;
  const baseDelay = options.delayMs ?? 100;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt === retries || code === undefined || !TRANSIENT_CODES.has(code)) {
        throw error;
      }
      await delay(baseDelay * (attempt + 1));
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
