import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;

export interface DurableLockOptions {
  staleAfterMs?: number;
  timeoutMs?: number;
  renewIntervalMs?: number;
}

export interface DurableLockRelease {
  (): Promise<void>;
  renew(): Promise<void>;
}

export async function acquireDurableLock(
  lockPath: string,
  options: DurableLockOptions = {}
): Promise<DurableLockRelease> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (;;) {
    try {
      await mkdir(lockPath, { recursive: false });
      const lockToken = randomUUID();
      await writeFile(
        path.join(lockPath, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
          lockToken,
          // Kept for compatibility with the wave-0 regression introduced
          // before the canonical lockToken field was specified.
          token: lockToken
        }),
        { encoding: "utf8", mode: 0o600 }
      );
      let released = false;
      let renewalError: unknown;
      let renewTimer: ReturnType<typeof setInterval> | undefined;
      const renew = async (): Promise<void> => {
        if (released) return;
        if (renewalError !== undefined) throw renewalError;
        const owner = JSON.parse(
          await readFile(path.join(lockPath, "owner.json"), "utf8")
        ) as { lockToken?: string; token?: string };
        if ((owner.lockToken ?? owner.token) !== lockToken) {
          throw new Error(`Cannot renew durable lock ${lockPath}: ownership was lost.`);
        }
        const now = new Date();
        await utimes(lockPath, now, now);
      };
      const release = async () => {
        released = true;
        if (renewTimer !== undefined) clearInterval(renewTimer);
        try {
          const owner = JSON.parse(
            await readFile(path.join(lockPath, "owner.json"), "utf8")
          ) as { lockToken?: string; token?: string };
          if ((owner.lockToken ?? owner.token) === lockToken) {
            await rm(lockPath, { recursive: true, force: true });
          }
        } catch (error) {
          if (!isNotFound(error) && !isInvalidJson(error)) throw error;
        }
      };
      release.renew = renew;
      const renewIntervalMs = options.renewIntervalMs ?? Math.max(1, Math.floor(staleAfterMs / 3));
      if (renewIntervalMs > 0) {
        renewTimer = setInterval(() => {
          void renew().catch((error: unknown) => {
            renewalError ??= error;
          });
        }, renewIntervalMs);
        renewTimer.unref?.();
      }
      return release;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      // A waiter whose own deadline has expired no longer has authority to
      // inspect and reclaim another owner's lock. Checking before stale-lock
      // recovery also prevents a delayed event loop from turning a timeout
      // into a destructive late reclaim.
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for durable lock ${lockPath}.`);
      }
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleAfterMs) {
          await reclaimStaleLock(lockPath, info.mtimeMs);
          continue;
        }
      } catch (inspectionError) {
        if (isNotFound(inspectionError)) continue;
        throw inspectionError;
      }
      await delay(10);
    }
  }
}

async function reclaimStaleLock(lockPath: string, observedMtimeMs: number): Promise<void> {
  const current = await stat(lockPath);
  if (current.mtimeMs === observedMtimeMs) {
    const quarantine = `${lockPath}.stale.${randomUUID()}`;
    try {
      // Moving the exact stale generation away before deletion prevents a
      // reclaimer from recursively deleting a successor that acquired the
      // canonical path in the meantime.
      await rename(lockPath, quarantine);
      await rm(quarantine, { recursive: true, force: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isInvalidJson(error: unknown): boolean {
  return error instanceof SyntaxError;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
