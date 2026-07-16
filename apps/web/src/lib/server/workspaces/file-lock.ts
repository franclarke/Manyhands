import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceConflictError } from "./errors";

const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 15;
const RENAME_RETRIES = 5;

interface FileLockOwner {
  token: string;
  pid: number;
  acquiredAt: string;
}

interface FileLockLease extends FileLockOwner {
  lockDir: string;
}

interface TakeoverOwner extends FileLockOwner {
  lockToken: string | null;
  purpose: "takeover" | "release";
}

interface TakeoverObservation {
  owner: TakeoverOwner | undefined;
  fingerprint: string;
  identityFingerprint: string;
  mtimeMs: number;
}

export interface WorkspaceFileLockOptions {
  acquireTimeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
  /** @internal Deterministic release-failure seam for lock regression tests. */
  releaseRename?: (from: string, to: string) => Promise<void>;
  /** @internal Deterministic takeover/release interleaving seam for lock regression tests. */
  beforeQuarantineRename?: () => Promise<void>;
  /** @internal Pauses after validating an observed marker but before attempting its claim. */
  beforeClaimRename?: () => Promise<void>;
  /** @internal Pauses after moving the canonical marker but before validating its identity. */
  afterClaimRename?: () => Promise<void>;
  /** @internal Signals that a stale claim moved a replacement marker and was rolled back. */
  afterClaimIdentityMismatch?: () => Promise<void>;
  /** @internal Signals that marker publication was fenced by another live claim. */
  afterForeignClaimBlocked?: () => Promise<void>;
}

/**
 * Cross-process mutex for the single workspace JSON document.
 *
 * Renaming a fully-populated unique candidate directory is the ownership
 * linearization point. This avoids ever publishing a live lock without its
 * owner metadata. A dead/corrupt owner is only quarantined after a grace
 * period and after winning an exclusive takeover marker inside the old lock
 * directory, so competing recovery processes cannot quarantine each other's
 * fresh owner.
 */
export async function withWorkspaceFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  options: WorkspaceFileLockOptions = {}
): Promise<T> {
  const lease = await acquireWorkspaceFileLock(filePath, options);
  try {
    const result = await operation();
    try {
      await releaseWorkspaceFileLock(lease, options.releaseRename);
    } catch (error) {
      // The critical section already committed. Returning an error here would
      // invite a retry of a mutation that durably succeeded. Publish a
      // token-scoped release intent so another process may recover this lock
      // even while our PID is alive. Only fall back to background cleanup when
      // the intent itself could not be persisted.
      const intentPersisted = await persistReleaseIntent(lease).then(
        () => true,
        (intentError) => {
          console.error(
            `[WorkspaceLock] Could not persist release intent for ${lease.lockDir}: ${String(intentError)}`
          );
          return false;
        }
      );
      if (!intentPersisted) scheduleReleaseRetry(lease);
      console.error(
        `[WorkspaceLock] Mutation committed but lock release failed for ${lease.lockDir}; ` +
          `commit wins and the next acquirer will adopt token-scoped cleanup: ${String(error)}`
      );
    }
    return result;
  } catch (operationError) {
    await releaseWorkspaceFileLock(lease, options.releaseRename).catch(async (releaseError) => {
      console.error(
        `[WorkspaceLock] Operation failed and lock cleanup also failed for ${lease.lockDir}: ${String(releaseError)}`
      );
      const intentPersisted = await persistReleaseIntent(lease).then(
        () => true,
        (intentError) => {
          console.error(
            `[WorkspaceLock] Could not persist release intent for ${lease.lockDir}: ${String(intentError)}`
          );
          return false;
        }
      );
      if (!intentPersisted) scheduleReleaseRetry(lease);
    });
    throw operationError;
  }
}

async function acquireWorkspaceFileLock(
  filePath: string,
  options: WorkspaceFileLockOptions
): Promise<FileLockLease> {
  const lockDir = `${filePath}.lock`;
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const deadline = Date.now() + acquireTimeoutMs;
  await mkdir(path.dirname(filePath), { recursive: true });

  for (;;) {
    const owner: FileLockOwner = {
      token: randomUUID(),
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    const candidateDir = `${lockDir}.candidate-${owner.pid}-${owner.token}`;
    let published = false;
    try {
      await mkdir(candidateDir);
      await writeFile(path.join(candidateDir, "owner.json"), JSON.stringify(owner), {
        encoding: "utf8",
        flag: "wx"
      });
      published = await publishCandidate(candidateDir, lockDir);
      if (published) return { ...owner, lockDir };
    } finally {
      if (!published) {
        await rm(candidateDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    if (await quarantineAbandonedLock(
      lockDir,
      staleMs,
      options.beforeQuarantineRename,
      options.beforeClaimRename,
      options.afterClaimRename,
      options.afterClaimIdentityMismatch,
      options.afterForeignClaimBlocked
    )) continue;
    if (Date.now() >= deadline) {
      const observed = await readOwner(lockDir);
      const detail = observed === undefined
        ? "an incomplete or unreadable owner"
        : `pid ${observed.pid}, token ${observed.token.slice(0, 8)}`;
      throw new WorkspaceConflictError(
        `Timed out waiting for the workspace store lock at ${lockDir} (${detail}). ` +
          "Another ManyHands process may still be updating workspaces; retry after it finishes."
      );
    }
    await delay(retryMs + Math.floor(Math.random() * retryMs));
  }
}

async function publishCandidate(candidateDir: string, lockDir: string): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(candidateDir, lockDir);
      return true;
    } catch (error) {
      const code = isErrno(error) ? error.code : undefined;
      if (code === "EEXIST" || code === "ENOTEMPTY") return false;
      if (code === "EPERM" || code === "EACCES" || code === "EBUSY") {
        if (await pathExists(lockDir)) return false;
        if (attempt < RENAME_RETRIES) {
          await delay(10 + Math.floor(Math.random() * 20));
          continue;
        }
      }
      throw error;
    }
  }
}

async function quarantineAbandonedLock(
  lockDir: string,
  staleMs: number,
  beforeQuarantineRename?: () => Promise<void>,
  beforeClaimRename?: () => Promise<void>,
  afterClaimRename?: () => Promise<void>,
  afterClaimIdentityMismatch?: () => Promise<void>,
  afterForeignClaimBlocked?: () => Promise<void>
): Promise<boolean> {
  const observed = await readOwner(lockDir);
  const releasedByOwner = await hasMatchingReleaseIntent(lockDir, observed);
  if (!releasedByOwner && !await ownerIsAbandoned(lockDir, observed, staleMs)) return false;

  const takeoverPath = path.join(lockDir, "takeover");
  const takeoverOwner: TakeoverOwner = {
    token: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    lockToken: observed?.token ?? null,
    purpose: "takeover"
  };
  const published = await publishTakeoverMarker(
    takeoverPath,
    takeoverOwner,
    undefined,
    staleMs,
    afterForeignClaimBlocked
  );
  if (!published) {
    const existingTakeover = await observeTakeover(takeoverPath);
    if (!takeoverIsAbandoned(
      existingTakeover,
      staleMs,
      releasedByOwner,
      observed?.token ?? null
    )) return false;
    const claimedTakeoverPath = `${takeoverPath}.claimed-${takeoverOwner.token}`;
    if (!await claimObservedTakeover(
      takeoverPath,
      claimedTakeoverPath,
      existingTakeover,
      takeoverOwner,
      beforeClaimRename,
      afterClaimRename,
      afterClaimIdentityMismatch
    )) return false;
    try {
      if (!await publishTakeoverMarker(
        takeoverPath,
        takeoverOwner,
        takeoverOwner.token,
        staleMs
      )) {
        await restoreClaimedTakeover(takeoverPath, claimedTakeoverPath);
        await removeClaimOwner(claimedTakeoverPath, takeoverOwner);
        return false;
      }

      // Claiming the exact abandoned marker and then publishing our own marker
      // is the recovery linearization. The claim sidecar prevents a stale
      // contender from authorizing a replacement during either rename gap.
      const current = await readOwner(lockDir);
      const currentReleasedByOwner = await hasMatchingReleaseIntent(lockDir, current);
      if (
        !sameOwner(observed, current) ||
        !sameTakeoverOwner(takeoverOwner, (await observeTakeover(takeoverPath))?.owner) ||
        (current !== undefined && processIsAlive(current.pid) && !currentReleasedByOwner)
      ) {
        await removeOwnedTakeoverMarker(takeoverPath, takeoverOwner).catch(() => undefined);
        await restoreClaimedTakeover(takeoverPath, claimedTakeoverPath);
        await removeClaimOwner(claimedTakeoverPath, takeoverOwner);
        return false;
      }
      await beforeQuarantineRename?.();
      if (
        !sameOwner(observed, await readOwner(lockDir)) ||
        !sameTakeoverOwner(takeoverOwner, (await observeTakeover(takeoverPath))?.owner) ||
        await hasForeignActiveClaim(takeoverPath, takeoverOwner.token, staleMs)
      ) {
        await removeOwnedTakeoverMarker(takeoverPath, takeoverOwner).catch(() => undefined);
        await restoreClaimedTakeover(takeoverPath, claimedTakeoverPath);
        await removeClaimOwner(claimedTakeoverPath, takeoverOwner);
        return false;
      }
      return quarantineLockDirectory(lockDir);
    } catch (error) {
      await removeOwnedTakeoverMarker(takeoverPath, takeoverOwner).catch(() => undefined);
      await restoreClaimedTakeover(takeoverPath, claimedTakeoverPath);
      await removeClaimOwner(claimedTakeoverPath, takeoverOwner);
      throw error;
    }
  }

  const current = await readOwner(lockDir);
  // Creating the takeover marker refreshes the directory mtime, so the grace
  // period must not be measured a second time here. The pre-marker check
  // already proved staleness; now only ownership/liveness may veto takeover.
  const currentReleasedByOwner = await hasMatchingReleaseIntent(lockDir, current);
  if (
    !sameOwner(observed, current) ||
    !takeoverMatchesLock(takeoverOwner, current) ||
    !sameTakeoverOwner(takeoverOwner, (await observeTakeover(takeoverPath))?.owner) ||
    (current !== undefined && processIsAlive(current.pid) && !currentReleasedByOwner)
  ) {
    await removeOwnedTakeoverMarker(takeoverPath, takeoverOwner).catch(() => undefined);
    return false;
  }

  await beforeQuarantineRename?.();
  if (
    !sameOwner(observed, await readOwner(lockDir)) ||
    !sameTakeoverOwner(takeoverOwner, (await observeTakeover(takeoverPath))?.owner) ||
    await hasForeignActiveClaim(takeoverPath, undefined, staleMs)
  ) {
    await removeOwnedTakeoverMarker(takeoverPath, takeoverOwner).catch(() => undefined);
    return false;
  }
  return quarantineLockDirectory(lockDir);
}

async function claimObservedTakeover(
  takeoverPath: string,
  claimedPath: string,
  observed: TakeoverObservation | undefined,
  claimant: TakeoverOwner,
  beforeClaimRename?: () => Promise<void>,
  afterClaimRename?: () => Promise<void>,
  afterClaimIdentityMismatch?: () => Promise<void>
): Promise<boolean> {
  if (observed === undefined) return false;
  if (!sameTakeoverObservation(observed, await observeTakeover(takeoverPath))) return false;
  await beforeClaimRename?.();
  const claimOwnerPath = claimOwnerFile(claimedPath);
  await writeFile(claimOwnerPath, JSON.stringify(claimant), { encoding: "utf8", flag: "wx" });
  try {
    await renameWithRetry(takeoverPath, claimedPath);
  } catch (error) {
    await rm(claimOwnerPath, { force: true }).catch(() => undefined);
    if (
      isErrno(error) &&
      (error.code === "ENOENT" || error.code === "EEXIST" || error.code === "ENOTEMPTY")
    ) return false;
    throw error;
  }
  try {
    await afterClaimRename?.();
    // `rename` is not a compare-and-swap: another recovery process may replace
    // the canonical path after our precheck. Validate the identity actually
    // moved before treating the claim as authoritative.
    if (sameTakeoverIdentity(observed, await observeTakeover(claimedPath))) return true;
    await restoreClaimedTakeover(takeoverPath, claimedPath);
    await removeClaimOwner(claimedPath, claimant);
    await afterClaimIdentityMismatch?.();
    return false;
  } catch (error) {
    await restoreClaimedTakeover(takeoverPath, claimedPath);
    await removeClaimOwner(claimedPath, claimant);
    throw error;
  }
}

async function restoreClaimedTakeover(takeoverPath: string, claimedPath: string): Promise<void> {
  if (!await pathExists(claimedPath)) return;
  try {
    await renameWithRetry(claimedPath, takeoverPath);
  } catch (error) {
    if (
      isErrno(error) &&
      (error.code === "ENOENT" || error.code === "EEXIST" || error.code === "ENOTEMPTY")
    ) return;
    if (
      isErrno(error) &&
      (error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY") &&
      await pathExists(takeoverPath)
    ) return;
    throw error;
  }
}

async function quarantineLockDirectory(lockDir: string): Promise<boolean> {
  const quarantine = `${lockDir}.abandoned-${process.pid}-${randomUUID()}`;
  try {
    await renameWithRetry(lockDir, quarantine);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return false;
    throw error;
  }
  await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
  return true;
}

async function publishTakeoverMarker(
  takeoverPath: string,
  owner: TakeoverOwner,
  ownClaimToken?: string,
  staleMs = DEFAULT_STALE_MS,
  afterForeignClaimBlocked?: () => Promise<void>
): Promise<boolean> {
  // Claim sidecars use never-reused token paths. Checking before publication
  // avoids needless marker churn; the mandatory post-publication check below
  // closes the race where a claimant appears between this check and rename.
  if (await hasForeignActiveClaim(takeoverPath, ownClaimToken, staleMs)) {
    await afterForeignClaimBlocked?.();
    return false;
  }
  const candidatePath = `${takeoverPath}.candidate-${owner.pid}-${owner.token}`;
  let published = false;
  try {
    await mkdir(candidatePath);
    await writeFile(path.join(candidatePath, "owner.json"), JSON.stringify(owner), {
      encoding: "utf8",
      flag: "wx"
    });
    published = await publishCandidate(candidatePath, takeoverPath);
    if (
      published &&
      await hasForeignActiveClaim(takeoverPath, ownClaimToken, staleMs)
    ) {
      await removeOwnedTakeoverMarker(takeoverPath, owner).catch(() => undefined);
      published = false;
      await afterForeignClaimBlocked?.();
    }
    return published;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return false;
    throw error;
  } finally {
    if (!published) {
      await rm(candidatePath, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function claimOwnerFile(claimedPath: string): string {
  return `${claimedPath}.claim.json`;
}

async function removeClaimOwner(claimedPath: string, claimant: TakeoverOwner): Promise<void> {
  const ownerPath = claimOwnerFile(claimedPath);
  const current = await readFileOwner(ownerPath);
  if (!sameTakeoverOwner(claimant, current)) return;
  await rm(ownerPath, { force: true }).catch(() => undefined);
}

async function hasForeignActiveClaim(
  takeoverPath: string,
  ownClaimToken: string | undefined,
  staleMs: number
): Promise<boolean> {
  const lockDir = path.dirname(takeoverPath);
  const prefix = `${path.basename(takeoverPath)}.claimed-`;
  let entries: string[];
  try {
    entries = await readdir(lockDir);
  } catch (error) {
    if (isErrno(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".claim.json")) continue;
    const ownerPath = path.join(lockDir, entry);
    const owner = await readFileOwner(ownerPath);
    if (owner?.token === ownClaimToken) continue;
    if (owner !== undefined && processIsAlive(owner.pid)) return true;
    if (owner === undefined) {
      try {
        if (Date.now() - (await stat(ownerPath)).mtimeMs < staleMs) return true;
      } catch (error) {
        if (!isErrno(error) || error.code !== "ENOENT") throw error;
      }
    }
    await rm(ownerPath, { force: true }).catch(() => undefined);
  }
  return false;
}

async function readFileOwner(ownerPath: string): Promise<TakeoverOwner | undefined> {
  try {
    return parseTakeoverOwner(await readFile(ownerPath, "utf8"));
  } catch (error) {
    if (isErrno(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
    throw error;
  }
}

async function observeTakeover(takeoverPath: string): Promise<TakeoverObservation | undefined> {
  try {
    const markerStat = await stat(takeoverPath);
    const metadataPath = markerStat.isDirectory()
      ? path.join(takeoverPath, "owner.json")
      : takeoverPath;
    let rawOwner = "";
    let metadataFingerprint = "missing";
    try {
      rawOwner = await readFile(metadataPath, "utf8");
      const metadataStat = await stat(metadataPath);
      metadataFingerprint = statFingerprint(metadataStat);
    } catch (error) {
      if (!isErrno(error) || (error.code !== "ENOENT" && error.code !== "ENOTDIR")) throw error;
    }
    return {
      owner: parseTakeoverOwner(rawOwner),
      fingerprint: JSON.stringify({
        marker: statFingerprint(markerStat),
        metadata: metadataFingerprint,
        rawOwner
      }),
      identityFingerprint: JSON.stringify({
        marker: statIdentityFingerprint(markerStat),
        metadata: metadataFingerprint === "missing"
          ? "missing"
          : rawOwner
      }),
      mtimeMs: markerStat.mtimeMs
    };
  } catch (error) {
    if (isErrno(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
    throw error;
  }
}

function parseTakeoverOwner(rawOwner: string): TakeoverOwner | undefined {
  try {
    const value = JSON.parse(rawOwner) as Partial<TakeoverOwner>;
    if (
      typeof value.token !== "string" ||
      typeof value.pid !== "number" ||
      typeof value.acquiredAt !== "string" ||
      (typeof value.lockToken !== "string" && value.lockToken !== null) ||
      (value.purpose !== undefined && value.purpose !== "takeover" && value.purpose !== "release")
    ) {
      return undefined;
    }
    return {
      token: value.token,
      pid: value.pid,
      acquiredAt: value.acquiredAt,
      lockToken: value.lockToken,
      purpose: value.purpose ?? "takeover"
    };
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function statFingerprint(value: Awaited<ReturnType<typeof stat>>): string {
  return [
    value.dev,
    value.ino,
    value.birthtimeMs,
    value.ctimeMs,
    value.mtimeMs,
    value.size,
    value.mode,
    value.isDirectory() ? "dir" : "file"
  ].join(":");
}

function statIdentityFingerprint(value: Awaited<ReturnType<typeof stat>>): string {
  return [
    value.dev,
    value.ino,
    value.birthtimeMs,
    value.mode,
    value.isDirectory() ? "dir" : "file"
  ].join(":");
}

function takeoverIsAbandoned(
  observation: TakeoverObservation | undefined,
  staleMs: number,
  releasedByOwner = false,
  expectedLockToken: string | null = null
): boolean {
  if (observation === undefined) return false;
  const owner = observation.owner;
  if (owner !== undefined) {
    if (
      releasedByOwner &&
      owner.purpose === "release" &&
      owner.lockToken === expectedLockToken
    ) return true;
    // A valid marker owned by a live process remains authoritative. Stealing
    // it merely because a wall-clock threshold elapsed would let that process
    // resume and rename a newly published lock. Dead owners are recoverable;
    // stale recovery below is reserved for legacy/corrupt markers that no
    // current implementation can resume from.
    return !processIsAlive(owner.pid);
  }
  // Legacy versions wrote a raw `pid:uuid` file. Corrupt/incomplete markers
  // use their own mtime as the grace clock and are recoverable without being
  // deleted in place once that exact observation is stale.
  return Date.now() - observation.mtimeMs >= staleMs;
}

function takeoverMatchesLock(
  takeover: TakeoverOwner | undefined,
  owner: FileLockOwner | undefined
): boolean {
  return takeover !== undefined && takeover.lockToken === (owner?.token ?? null);
}

function sameTakeoverOwner(
  left: TakeoverOwner | undefined,
  right: TakeoverOwner | undefined
): boolean {
  return sameOwner(left, right) &&
    left?.lockToken === right?.lockToken &&
    left?.purpose === right?.purpose;
}

function sameTakeoverObservation(
  left: TakeoverObservation | undefined,
  right: TakeoverObservation | undefined
): boolean {
  return left !== undefined && right !== undefined && left.fingerprint === right.fingerprint;
}

function sameTakeoverIdentity(
  left: TakeoverObservation | undefined,
  right: TakeoverObservation | undefined
): boolean {
  return left !== undefined &&
    right !== undefined &&
    left.identityFingerprint === right.identityFingerprint;
}

async function removeOwnedTakeoverMarker(
  takeoverPath: string,
  owner: TakeoverOwner
): Promise<void> {
  if (!sameTakeoverOwner(owner, (await observeTakeover(takeoverPath))?.owner)) return;
  const releasePath = `${takeoverPath}.release-${owner.token}`;
  try {
    await renameWithRetry(takeoverPath, releasePath);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return;
    throw error;
  }
  if (sameTakeoverOwner(owner, (await observeTakeover(releasePath))?.owner)) {
    await rm(releasePath, { recursive: true, force: true });
    return;
  }
  await renameWithRetry(releasePath, takeoverPath).catch(() => undefined);
}

async function releaseWorkspaceFileLock(
  lease: FileLockLease,
  renameOperation: (from: string, to: string) => Promise<void> = rename
): Promise<void> {
  const owner = await readOwner(lease.lockDir);
  if (!sameOwner(lease, owner)) return;
  // A matching intent is the durable ownership handoff. Once published, this
  // process must never race a recovery challenger by moving the canonical
  // path; the next acquirer adopts and quarantines it.
  if (await hasMatchingReleaseIntent(lease.lockDir, owner)) return;

  // Release and abandoned-lock takeover share the same exclusive transition
  // marker. Whichever publishes it first owns the only path transition from
  // this lock identity. This closes the otherwise unavoidable window where a
  // release could move the old lock, a new owner could publish at lockDir, and
  // a previously validated challenger could quarantine that fresh owner.
  const transitionPath = path.join(lease.lockDir, "takeover");
  const transitionOwner: TakeoverOwner = {
    token: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    lockToken: lease.token,
    purpose: "release"
  };
  if (!await publishTakeoverMarker(transitionPath, transitionOwner)) {
    throw new WorkspaceConflictError(
      `Workspace store lock ${lease.lockDir} is already transitioning; release will retry.`
    );
  }
  const currentOwner = await readOwner(lease.lockDir);
  const currentTransition = (await observeTakeover(transitionPath))?.owner;
  if (
    !sameOwner(lease, currentOwner) ||
    !sameTakeoverOwner(transitionOwner, currentTransition)
  ) {
    await removeOwnedTakeoverMarker(transitionPath, transitionOwner).catch(() => undefined);
    if (!sameOwner(lease, currentOwner)) return;
    throw new WorkspaceConflictError(
      `Workspace store lock transition ownership changed while releasing ${lease.lockDir}.`
    );
  }

  const releaseDir = `${lease.lockDir}.release-${lease.token}`;
  if (await hasForeignActiveClaim(transitionPath, undefined, DEFAULT_STALE_MS)) {
    await removeOwnedTakeoverMarker(transitionPath, transitionOwner).catch(() => undefined);
    throw new WorkspaceConflictError(
      `Workspace store lock ${lease.lockDir} has an active recovery claim; release will retry.`
    );
  }
  try {
    await renameWithRetry(lease.lockDir, releaseDir, renameOperation);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return;
    await removeOwnedTakeoverMarker(transitionPath, transitionOwner).catch(() => undefined);
    throw error;
  }

  const movedOwner = await readOwner(releaseDir);
  if (!sameOwner(lease, movedOwner)) {
    await removeOwnedTakeoverMarker(
      path.join(releaseDir, "takeover"),
      transitionOwner
    ).catch(() => undefined);
    await renameWithRetry(releaseDir, lease.lockDir).catch(() => undefined);
    throw new WorkspaceConflictError(
      `Workspace store lock ownership changed while releasing ${lease.lockDir}; refusing to remove it.`
    );
  }
  // The ownership path is already free; a transient quarantine cleanup failure
  // must not turn a successfully persisted workspace mutation into a 500.
  await rm(releaseDir, { recursive: true, force: true }).catch(() => undefined);
}

async function persistReleaseIntent(lease: FileLockLease): Promise<void> {
  const owner = await readOwner(lease.lockDir);
  if (!sameOwner(lease, owner)) return;
  await writeFile(
    path.join(lease.lockDir, "release-intent.json"),
    JSON.stringify({ token: lease.token, pid: lease.pid, releasedAt: new Date().toISOString() }),
    "utf8"
  );
}

async function hasMatchingReleaseIntent(
  lockDir: string,
  owner: FileLockOwner | undefined
): Promise<boolean> {
  if (owner === undefined) return false;
  try {
    const value = JSON.parse(
      await readFile(path.join(lockDir, "release-intent.json"), "utf8")
    ) as Partial<FileLockOwner>;
    return value.token === owner.token && value.pid === owner.pid;
  } catch (error) {
    if (isErrno(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function scheduleReleaseRetry(lease: FileLockLease): void {
  const timer = setTimeout(() => {
    void releaseWorkspaceFileLock(lease).catch(() => scheduleReleaseRetry(lease));
  }, 250);
  timer.unref?.();
}

async function ownerIsAbandoned(
  lockDir: string,
  owner: FileLockOwner | undefined,
  staleMs: number
): Promise<boolean> {
  if (owner !== undefined && processIsAlive(owner.pid)) return false;
  try {
    const lockStat = await stat(lockDir);
    return Date.now() - lockStat.mtimeMs >= staleMs;
  } catch (error) {
    return isErrno(error) && error.code === "ENOENT";
  }
}

async function readOwner(lockDir: string): Promise<FileLockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(lockDir, "owner.json"), "utf8")) as Partial<FileLockOwner>;
    if (
      typeof value.token !== "string" ||
      typeof value.pid !== "number" ||
      typeof value.acquiredAt !== "string"
    ) {
      return undefined;
    }
    return { token: value.token, pid: value.pid, acquiredAt: value.acquiredAt };
  } catch (error) {
    if (isErrno(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function sameOwner(left: FileLockOwner | undefined, right: FileLockOwner | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.token === right.token && left.pid === right.pid;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrno(error) && error.code === "ESRCH") return false;
    // EPERM means the process exists but belongs to another OS user.
    return true;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(
  from: string,
  to: string,
  renameOperation: (from: string, to: string) => Promise<void> = rename
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameOperation(from, to);
      return;
    } catch (error) {
      const code = isErrno(error) ? error.code : undefined;
      if (
        attempt < RENAME_RETRIES &&
        (code === "EPERM" || code === "EACCES" || code === "EBUSY")
      ) {
        await delay(10 + Math.floor(Math.random() * 20));
        continue;
      }
      throw error;
    }
  }
}

function isErrno(value: unknown): value is NodeJS.ErrnoException {
  return typeof value === "object" && value !== null && "code" in value;
}
