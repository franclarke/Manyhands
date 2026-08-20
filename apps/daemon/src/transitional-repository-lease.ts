import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isProcessAlive, safeGitArgs } from "@manyhands/execution-core";

const execFileAsync = promisify(execFile);
const STALE_MS = 10 * 60 * 1_000;
const HEARTBEAT_MS = 4_000;
const ACQUIRE_GRACE_MS = 2_000;

interface RepositoryLeaseOwner {
  runId: string;
  pid: number;
  token: string;
  generation: number;
  acquiredAt: string;
}

interface TransitionalRepositoryLease extends RepositoryLeaseOwner {
  lockDir: string;
}

/**
 * Transitional copy of the current cross-process repository fence. It lives
 * in the daemon because the productive profile may not depend on Next/web.
 */
export async function withTransitionalRepositoryLease<T>(
  input: { repoRoot: string; runId: string },
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const lease = await acquire(input);
  const controller = new AbortController();
  let leaseLoss: Error | undefined;
  const stopHeartbeat = heartbeat(lease, (reason) => {
    leaseLoss = new Error(`Repository lease for ${input.runId} was lost: ${reason}.`);
    controller.abort(leaseLoss);
  });
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    await assertCurrent(lease);
    const result = await operation(controller.signal);
    if (leaseLoss !== undefined) throw leaseLoss;
    await assertCurrent(lease);
    outcome = { ok: true, value: result };
  } catch (error) {
    outcome = { ok: false, error };
  }
  stopHeartbeat();
  try {
    await release(lease);
  } catch (releaseError) {
    if (!outcome.ok) {
      throw new AggregateError(
        [outcome.error, releaseError],
        `Repository operation and lease release both failed for ${input.runId}.`
      );
    }
    throw releaseError;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function acquire(input: {
  repoRoot: string;
  runId: string;
}): Promise<TransitionalRepositoryLease> {
  const base = await lockBase(input.repoRoot);
  const lockDir = path.join(base, "run.lock");
  await mkdir(base, { recursive: true });
  let stolenGeneration = 0;

  for (let attempt = 0; attempt < 64; attempt += 1) {
    try {
      await mkdir(lockDir);
      const generation = Math.max(await generationAt(base), stolenGeneration) + 1;
      const owner: RepositoryLeaseOwner = {
        runId: input.runId,
        pid: process.pid,
        token: randomUUID(),
        generation,
        acquiredAt: new Date().toISOString()
      };
      await writeAtomic(path.join(lockDir, "owner.json"), owner);
      await writeAtomic(heartbeatPath(lockDir, owner.token), {
        token: owner.token,
        at: owner.acquiredAt
      });
      await writeAtomic(path.join(base, "run.lock.generation"), { generation });
      const verified = await readOwner(lockDir);
      if (verified?.token === owner.token) return { ...owner, lockDir };
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const observed = await readOwnerWithGrace(lockDir);
    if (observed !== undefined && await ownerIsLive(lockDir, observed)) {
      throw new Error(`Repository is owned by run ${observed.runId}.`);
    }
    const claim = randomUUID();
    try {
      await writeFile(path.join(lockDir, "takeover.claim"), claim, {
        encoding: "utf8",
        flag: "wx"
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EEXIST", "ENOENT", "ENOTDIR", "EPERM", "EBUSY"].includes(code ?? "")) {
        await delay(10);
        continue;
      }
      throw error;
    }
    const claimedOwner = await readOwnerWithGrace(lockDir);
    if (
      claimedOwner !== undefined
      && observed !== undefined
      && (
        claimedOwner.token !== observed.token
        || claimedOwner.generation !== observed.generation
      )
    ) {
      await removeOwnClaim(lockDir, claim);
      continue;
    }
    if (claimedOwner !== undefined && await ownerIsLive(lockDir, claimedOwner)) {
      await removeOwnClaim(lockDir, claim);
      throw new Error(`Repository is owned by run ${claimedOwner.runId}.`);
    }
    stolenGeneration = Math.max(stolenGeneration, claimedOwner?.generation ?? 0);
    const quarantine = `${lockDir}.stale-${randomUUID().slice(0, 8)}`;
    try {
      await rename(lockDir, quarantine);
      await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
    } catch {
      await removeOwnClaim(lockDir, claim);
      await delay(10);
    }
  }
  throw new Error(`Could not acquire the repository lease for run ${input.runId}.`);
}

function heartbeat(
  lease: TransitionalRepositoryLease,
  onLost: (reason: string) => void
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    void (async () => {
      const owner = await readOwner(lease.lockDir);
      if (owner?.token !== lease.token || owner.generation !== lease.generation) {
        if (!stopped) onLost("another owner replaced the fence");
        return;
      }
      await writeAtomic(heartbeatPath(lease.lockDir, lease.token), {
        token: lease.token,
        at: new Date().toISOString()
      });
    })().catch(() => undefined);
  }, HEARTBEAT_MS);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function assertCurrent(lease: TransitionalRepositoryLease): Promise<void> {
  const owner = await readOwner(lease.lockDir);
  if (owner?.token !== lease.token || owner.generation !== lease.generation) {
    throw new Error(`Repository lease for ${lease.runId} is no longer current.`);
  }
}

async function release(lease: TransitionalRepositoryLease): Promise<void> {
  const owner = await readOwner(lease.lockDir);
  if (owner?.token !== lease.token) return;
  const quarantine = `${lease.lockDir}.released-${lease.token.slice(0, 8)}`;
  try {
    await rename(lease.lockDir, quarantine);
  } catch (releaseError) {
    try {
      await markRelinquished(lease);
    } catch (markerError) {
      throw new AggregateError(
        [releaseError, markerError],
        `Repository lease release and relinquish marker both failed for ${lease.runId}.`
      );
    }
    throw releaseError;
  }
  const captured = await readOwner(quarantine);
  if (captured !== undefined && captured.token !== lease.token) {
    await rename(quarantine, lease.lockDir);
    throw new Error(`Repository lease for ${lease.runId} changed owner during release.`);
  }
  await rm(quarantine, { recursive: true, force: true });
}

async function ownerIsLive(
  lockDir: string,
  owner: RepositoryLeaseOwner
): Promise<boolean> {
  if (await wasRelinquished(lockDir, owner.token)) return false;
  // A heartbeat records that the owner was alive when it wrote the file; it
  // cannot keep a crashed process alive for the full stale window. Check the
  // physical owner first so restart recovery can reclaim a fresh orphaned lock.
  if (!await isProcessAlive(owner.pid)) return false;
  try {
    const beat = JSON.parse(await readFile(heartbeatPath(lockDir, owner.token), "utf8")) as {
      token?: unknown;
      at?: unknown;
    };
    if (beat.token === owner.token && typeof beat.at === "string") {
      const age = Date.now() - new Date(beat.at).getTime();
      if (Number.isFinite(age) && age >= 0 && age < STALE_MS) return true;
    }
  } catch {
    // A pre-heartbeat owner is still live while its physical process exists.
  }
  return true;
}

async function markRelinquished(lease: TransitionalRepositoryLease): Promise<void> {
  const owner = await readOwner(lease.lockDir);
  if (owner?.token !== lease.token) {
    throw new Error(`Repository lease for ${lease.runId} changed owner before relinquish.`);
  }
  await writeAtomic(relinquishedPath(lease.lockDir, lease.token), {
    token: lease.token,
    at: new Date().toISOString()
  });
}

async function wasRelinquished(lockDir: string, token: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(relinquishedPath(lockDir, token), "utf8")) as {
      token?: unknown;
    };
    return marker.token === token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

function relinquishedPath(lockDir: string, token: string): string {
  return path.join(lockDir, `released-${token}.json`);
}

async function lockBase(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      safeGitArgs(repoRoot, ["rev-parse", "--git-common-dir"]),
      { cwd: repoRoot, windowsHide: true, encoding: "utf8" }
    );
    const common = path.resolve(repoRoot, stdout.trim());
    return path.join(await realpath(common).catch(() => common), "manyhands");
  } catch {
    const resolved = await realpath(repoRoot).catch(() => path.resolve(repoRoot));
    return path.join(resolved, ".manyhands");
  }
}

async function readOwnerWithGrace(
  lockDir: string
): Promise<RepositoryLeaseOwner | undefined> {
  const deadline = Date.now() + ACQUIRE_GRACE_MS;
  for (;;) {
    const owner = await readOwner(lockDir);
    if (owner !== undefined) return owner;
    try {
      const current = await stat(lockDir);
      if (!current.isDirectory()) return undefined;
      if (Date.now() >= deadline || Date.now() - current.mtimeMs > ACQUIRE_GRACE_MS) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    await delay(25);
  }
}

async function readOwner(lockDir: string): Promise<RepositoryLeaseOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(lockDir, "owner.json"), "utf8")) as
      Partial<RepositoryLeaseOwner>;
    return typeof value.runId === "string"
      && typeof value.pid === "number"
      && typeof value.token === "string"
      && typeof value.generation === "number"
      && typeof value.acquiredAt === "string"
      ? value as RepositoryLeaseOwner
      : undefined;
  } catch {
    return undefined;
  }
}

async function generationAt(base: string): Promise<number> {
  try {
    const value = JSON.parse(await readFile(path.join(base, "run.lock.generation"), "utf8")) as {
      generation?: unknown;
    };
    return typeof value.generation === "number" ? value.generation : 0;
  } catch {
    return 0;
  }
}

async function writeAtomic(destination: string, value: unknown): Promise<void> {
  const temporary = `${destination}.tmp-${randomUUID().slice(0, 8)}`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function removeOwnClaim(lockDir: string, token: string): Promise<void> {
  const claim = path.join(lockDir, "takeover.claim");
  try {
    if (await readFile(claim, "utf8") === token) await rm(claim, { force: true });
  } catch {
    // The canonical lock changed; never remove an unverified foreign claim.
  }
}

function heartbeatPath(lockDir: string, token: string): string {
  return path.join(lockDir, `heartbeat-${token}.json`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
