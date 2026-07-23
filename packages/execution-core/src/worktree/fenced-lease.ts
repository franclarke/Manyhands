import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";

const OWNER_FILE = "owner.json";
const GENERATION_FILE = "generation.json";
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 4_000;
const ACQUIRE_GRACE_MS = 2_000;

export interface FilesystemLeaseOwner {
  ownerId: string;
  pid: number;
  token: string;
  generation: number;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface FilesystemFencedLease {
  lockDir: string;
  ownerId: string;
  token: string;
  generation: number;
  assertCurrent(): Promise<void>;
  release(): Promise<void>;
}

export interface FilesystemFencedLeaseOptions {
  staleMs?: number;
  heartbeatMs?: number;
  now?: () => Date;
  ownerIsAlive?: (pid: number) => Promise<boolean>;
}

export class FencedLeaseLostError extends Error {
  constructor(
    readonly lockDir: string,
    readonly token: string,
    readonly generation: number
  ) {
    super(`Lease ${path.basename(lockDir)} token ${token.slice(0, 8)} generation ${generation} is no longer current.`);
    this.name = "FencedLeaseLostError";
  }
}

export async function tryAcquireFilesystemFencedLease(
  lockDir: string,
  ownerId: string,
  options: FilesystemFencedLeaseOptions = {}
): Promise<FilesystemFencedLease | undefined> {
  const resolvedLockDir = path.resolve(lockDir);
  const parent = path.dirname(resolvedLockDir);
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const now = options.now ?? (() => new Date());
  const ownerIsAlive = options.ownerIsAlive ?? isProcessAlive;
  await mkdir(parent, { recursive: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await mkdir(resolvedLockDir);
      const generation = await nextGeneration(parent);
      const timestamp = now().toISOString();
      const owner: FilesystemLeaseOwner = {
        ownerId,
        pid: process.pid,
        token: randomUUID(),
        generation,
        acquiredAt: timestamp,
        heartbeatAt: timestamp
      };
      try {
        await writeJsonAtomic(path.join(resolvedLockDir, OWNER_FILE), owner);
        const verified = await readOwner(resolvedLockDir);
        if (verified?.token !== owner.token || verified.generation !== generation) {
          await rm(resolvedLockDir, { recursive: true, force: true }).catch(() => undefined);
          continue;
        }
        return createLease(resolvedLockDir, owner, { heartbeatMs, now });
      } catch (error) {
        await rm(resolvedLockDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }

    const observed = await readOwner(resolvedLockDir);
    if (!(await isReclaimable(
      resolvedLockDir,
      observed,
      staleMs,
      now(),
      ownerIsAlive
    ))) return undefined;
    const current = await readOwner(resolvedLockDir);
    if (!sameOwner(observed, current)) continue;
    const quarantine = `${resolvedLockDir}.stale-${randomUUID()}`;
    try {
      await rename(resolvedLockDir, quarantine);
    } catch (error) {
      if (!hasCode(error, "ENOENT") && !hasCode(error, "EEXIST")) {
        await delayWithJitter(attempt);
      }
      continue;
    }
    const captured = await readOwner(quarantine);
    if (!sameOwner(observed, captured)) {
      await rename(quarantine, resolvedLockDir).catch(() => undefined);
      continue;
    }
    await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
  }
  return undefined;
}

export async function readFilesystemLeaseOwner(
  lockDir: string
): Promise<FilesystemLeaseOwner | undefined> {
  return readOwner(path.resolve(lockDir));
}

function createLease(
  lockDir: string,
  owner: FilesystemLeaseOwner,
  options: { heartbeatMs: number; now: () => Date }
): FilesystemFencedLease {
  let released = false;
  let releasePromise: Promise<void> | undefined;
  let heartbeatPromise: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (released || heartbeatPromise !== undefined) return;
    const pulse = renew(lockDir, owner, options.now())
      .catch(() => undefined)
      .finally(() => {
        if (heartbeatPromise === pulse) heartbeatPromise = undefined;
      });
    heartbeatPromise = pulse;
  }, options.heartbeatMs);
  timer.unref();

  return {
    lockDir,
    ownerId: owner.ownerId,
    token: owner.token,
    generation: owner.generation,
    assertCurrent: async () => {
      const current = await readOwner(lockDir);
      if (!sameOwner(owner, current)) {
        throw new FencedLeaseLostError(lockDir, owner.token, owner.generation);
      }
    },
    release: async () => {
      if (released) return;
      if (releasePromise !== undefined) return releasePromise;
      clearInterval(timer);
      const pending = (async () => {
        await heartbeatPromise;
        await releaseOwnedLock(lockDir, owner);
        released = true;
      })();
      releasePromise = pending;
      try {
        await pending;
      } finally {
        if (releasePromise === pending) releasePromise = undefined;
      }
    }
  };
}

async function renew(
  lockDir: string,
  owner: FilesystemLeaseOwner,
  now: Date
): Promise<void> {
  const current = await readOwner(lockDir);
  if (!sameOwner(owner, current)) {
    throw new FencedLeaseLostError(lockDir, owner.token, owner.generation);
  }
  await writeJsonAtomic(path.join(lockDir, OWNER_FILE), {
    ...owner,
    heartbeatAt: now.toISOString()
  });
}

async function releaseOwnedLock(
  lockDir: string,
  owner: FilesystemLeaseOwner
): Promise<void> {
  const current = await readOwner(lockDir);
  if (!sameOwner(owner, current)) return;
  const quarantine = `${lockDir}.released-${owner.token.slice(0, 8)}-${randomUUID()}`;
  await renameWithRetry(lockDir, quarantine);
  const captured = await readOwner(quarantine);
  if (!sameOwner(owner, captured)) {
    await rename(quarantine, lockDir).catch(() => undefined);
    return;
  }
  await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
}

async function isReclaimable(
  lockDir: string,
  owner: FilesystemLeaseOwner | undefined,
  staleMs: number,
  now: Date,
  ownerIsAlive: (pid: number) => Promise<boolean>
): Promise<boolean> {
  if (owner === undefined) {
    try {
      return now.getTime() - (await stat(lockDir)).mtimeMs >= ACQUIRE_GRACE_MS;
    } catch {
      return true;
    }
  }
  const heartbeatAge = now.getTime() - Date.parse(owner.heartbeatAt);
  if (!Number.isFinite(heartbeatAge) || heartbeatAge < staleMs) return false;
  // A token can fence publication, but it cannot stop a paused process from
  // resuming writes in the same directory. Reuse is safe only after the old
  // local process is gone.
  return !(await ownerIsAlive(owner.pid));
}

async function nextGeneration(parent: string): Promise<number> {
  const generationPath = path.join(parent, GENERATION_FILE);
  let current = 0;
  try {
    const parsed = JSON.parse(await readFile(generationPath, "utf8")) as {
      generation?: unknown;
    };
    if (typeof parsed.generation === "number" && Number.isSafeInteger(parsed.generation)) {
      current = parsed.generation;
    }
  } catch {
    current = 0;
  }
  const generation = current + 1;
  await writeJsonAtomic(generationPath, { generation });
  return generation;
}

async function readOwner(lockDir: string): Promise<FilesystemLeaseOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path.join(lockDir, OWNER_FILE), "utf8")) as
      Partial<FilesystemLeaseOwner>;
    if (
      typeof parsed.ownerId !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.token !== "string" ||
      typeof parsed.generation !== "number" ||
      typeof parsed.acquiredAt !== "string" ||
      typeof parsed.heartbeatAt !== "string"
    ) {
      return undefined;
    }
    return parsed as FilesystemLeaseOwner;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(temporary, target);
    await syncDirectoryBestEffort(path.dirname(target));
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not supported by every Windows filesystem.
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (
        attempt >= 5 ||
        (!hasCode(error, "EPERM") && !hasCode(error, "EACCES") && !hasCode(error, "EBUSY"))
      ) {
        throw error;
      }
      await delayWithJitter(attempt);
    }
  }
}

function sameOwner(
  left: FilesystemLeaseOwner | undefined,
  right: FilesystemLeaseOwner | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.token === right.token && left.generation === right.generation;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function delayWithJitter(attempt: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, 5 + attempt * 5 + Math.floor(Math.random() * 10))
  );
}

async function isProcessAlive(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}
