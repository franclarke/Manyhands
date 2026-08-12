/**
 * Per-target-repo run lock, hardened for B-004 (CF-04).
 *
 * Exactly one valid owner per git common directory:
 *
 *  - The lock is a DIRECTORY (`<lockRoot>/.manyhands/run.lock`) created with
 *    an atomic `mkdir`: of N concurrent acquirers exactly one wins the slot.
 *  - Every acquisition mints an immutable random `token` plus a monotonic
 *    `generation` (fencing token) persisted next to the lock. Validity is
 *    defined by `owner.json`: a lease whose token/generation no longer match
 *    is dead forever — it cannot renew, release or pass fencing.
 *  - Stale takeover is conditional: contenders first create one exclusive
 *    claim inside the current lock and re-check that exact owner before
 *    `rename`-ing it to quarantine. A delayed stale decision therefore cannot
 *    move a replacement lock. A fresh winner additionally verifies its own
 *    token after writing before the lease is handed out.
 *  - Release/renew verify the token first and never clobber a foreign lock;
 *    a release that raced a takeover restores the victim.
 *  - Liveness is heartbeat-first: the holder renews a token-scoped heartbeat
 *    file; PID and RunRecord heartbeats are only fallbacks (never the sole
 *    signal, and never trusted while a fresh lock heartbeat exists).
 *  - The lock is keyed by the git common directory (`git rev-parse
 *    --git-common-dir`), so two paths into the same repository — including
 *    linked worktrees — contend on one lock. For git repos the lock lives
 *    INSIDE the common dir (`.git/manyhands/`), keeping the source checkout's
 *    `git status` pristine (B-001). Non-git paths fall back to
 *    `<path>/.manyhands/`.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { isProcessAlive, safeGitArgs } from "@manyhands/execution-core";
import { DEFAULT_STALE_MS } from "./interrupted";
import { isRunnerActive } from "./runner-state";
import { getRunRepository } from "./store";

const execFileAsync = promisify(execFile);

const LOCK_DIR_NAME = "run.lock";
const GENERATION_FILE = "run.lock.generation";
const TAKEOVER_CLAIM_FILE = "takeover.claim";
/** A lock dir without owner.json younger than this is a write in progress. */
const ACQUIRE_GRACE_MS = 2_000;
/**
 * Contention budget: a contender keeps re-racing the mkdir/rename until it
 * either wins or OBSERVES a live owner. Only pathological loops hit these.
 */
const ACQUIRE_DEADLINE_MS = 10_000;
const MAX_ACQUIRE_ATTEMPTS = 64;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 4_000;
/** Bounded retries for Windows EPERM/EACCES rename transients. */
const RENAME_RETRIES = 5;

export interface RepoLockOwner {
  runId: string;
  pid: number;
  /** Immutable per acquisition; empty string only for legacy file locks. */
  token: string;
  /** Monotonic fencing generation per lock root; 0 only for legacy locks. */
  generation: number;
  acquiredAt: string;
}

/** Capability returned by a successful acquisition. Required to renew/release/fence. */
export interface RepoLease {
  repoRoot: string;
  lockDir: string;
  runId: string;
  pid: number;
  token: string;
  generation: number;
  acquiredAt: string;
}

/**
 * B-019 common wrapper for a bounded Git mutation. It resolves/acquires the
 * same common-dir lease used by runners, keeps it alive, fences before and
 * after the mutation, and only releases its own capability.
 */
export async function withRepositoryLease<T>(
  input: { repoRoot: string; runId: string },
  operation: (lease: RepoLease, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const claimed = await acquireRepoLock(input.repoRoot, input.runId);
  if (!claimed.acquired) {
    throw new RepoLeaseLostError(
      {
        repoRoot: input.repoRoot,
        lockDir: "",
        runId: input.runId,
        pid: process.pid,
        token: "",
        generation: 0,
        acquiredAt: new Date().toISOString()
      },
      `repository is owned by run ${claimed.owner.runId}`
    );
  }
  const controller = new AbortController();
  let leaseLoss: RepoLeaseLostError | undefined;
  const stopHeartbeat = startRepoLeaseHeartbeat(claimed.lease, {
    onLost: (reason) => {
      leaseLoss = new RepoLeaseLostError(claimed.lease, reason);
      controller.abort(leaseLoss);
    }
  });
  try {
    await assertRepoLeaseCurrent(claimed.lease);
    let result: T;
    try {
      result = await operation(claimed.lease, controller.signal);
    } catch (error) {
      if (leaseLoss !== undefined) throw leaseLoss;
      throw error;
    }
    if (leaseLoss !== undefined) throw leaseLoss;
    await assertRepoLeaseCurrent(claimed.lease);
    return result;
  } finally {
    stopHeartbeat();
    await releaseRepoLease(claimed.lease).catch(() => undefined);
  }
}

export type RepoLockResult =
  | { acquired: true; stolen: boolean; lease: RepoLease }
  | { acquired: false; owner: RepoLockOwner };

export class RepoLeaseLostError extends Error {
  constructor(lease: RepoLease, reason: string) {
    super(
      `Repo lease for run ${lease.runId} (token ${lease.token.slice(0, 8)}…, generation ${lease.generation}) ` +
        `is no longer current: ${reason}. Refusing the side effect.`
    );
    this.name = "RepoLeaseLostError";
  }
}

/** Injectable for tests. */
export interface RepoLockDeps {
  ownerIsLive?: (owner: RepoLockOwner) => Promise<boolean>;
  now?: () => string;
  /** Heartbeat freshness window for the default liveness check. */
  staleMs?: number;
  /** Directory holding the lock artifacts for a repo path. */
  resolveLockBase?: (repoRoot: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Lock base resolution (git common directory keying)
// ---------------------------------------------------------------------------

const lockBaseCache = new Map<string, Promise<string>>();

function defaultResolveLockBase(repoRoot: string): Promise<string> {
  const cached = lockBaseCache.get(repoRoot);
  if (cached !== undefined) return cached;
  const resolved = (async () => {
    try {
      const { stdout } = await execFileAsync("git", safeGitArgs(repoRoot, ["-C", repoRoot, "rev-parse", "--git-common-dir"]), {
        windowsHide: true
      });
      let commonDir = resolvePath(repoRoot, stdout.trim());
      try {
        commonDir = await realpath(commonDir);
      } catch {
        // Keep the unresolved path.
      }
      // Inside the common dir: never appears in `git status` of the source.
      return join(commonDir, "manyhands");
    } catch {
      // Not a git repo (or git unavailable): key by the path itself.
      let root = repoRoot;
      try {
        root = await realpath(root);
      } catch {
        // Keep the unresolved path; containment is not this module's job.
      }
      return join(root, ".manyhands");
    }
  })();
  lockBaseCache.set(repoRoot, resolved);
  return resolved;
}

function heartbeatFileName(token: string): string {
  return `heartbeat-${token}.json`;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (i < RENAME_RETRIES && (code === "EPERM" || code === "EACCES" || code === "EBUSY")) {
        await sleep(10 + Math.floor(Math.random() * 20));
        continue;
      }
      throw error;
    }
  }
}

/** Write JSON durably next to its destination and publish it via rename. */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`;
  await writeFile(tmp, JSON.stringify(value), "utf8");
  try {
    await renameWithRetry(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function parseOwner(raw: string): RepoLockOwner | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<RepoLockOwner>;
    if (typeof parsed.runId !== "string" || typeof parsed.pid !== "number") return undefined;
    return {
      runId: parsed.runId,
      pid: parsed.pid,
      token: typeof parsed.token === "string" ? parsed.token : "",
      generation: typeof parsed.generation === "number" ? parsed.generation : 0,
      acquiredAt: typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : ""
    };
  } catch {
    return undefined;
  }
}

/**
 * Read the owner record at a lock path. Understands both the directory
 * format (`<lock>/owner.json`) and the legacy single-file format.
 */
async function readOwnerRecordAt(lockDir: string): Promise<RepoLockOwner | undefined> {
  try {
    return parseOwner(await readFile(join(lockDir, "owner.json"), "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    // ENOENT (missing owner.json), ENOTDIR (legacy file lock) — fall through.
  }
  try {
    return parseOwner(await readFile(lockDir, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return undefined;
    throw error;
  }
}

/**
 * Read the owner, tolerating the tiny window where a fresh winner has
 * created the directory but not yet published owner.json. Returns undefined
 * only for locks that are genuinely corrupt, abandoned mid-acquire beyond
 * the grace window, or gone.
 */
async function readOwnerWithGrace(lockDir: string): Promise<RepoLockOwner | undefined> {
  const deadline = Date.now() + ACQUIRE_GRACE_MS;
  for (;;) {
    const owner = await readOwnerRecordAt(lockDir);
    if (owner !== undefined) return owner;
    let stats;
    try {
      stats = await stat(lockDir);
    } catch {
      return undefined; // Lock gone: the caller re-races the mkdir.
    }
    if (!stats.isDirectory()) return undefined; // Corrupt legacy file.
    if (Date.now() >= deadline || Date.now() - stats.mtimeMs > ACQUIRE_GRACE_MS) {
      return undefined; // Abandoned between mkdir and owner.json.
    }
    await sleep(25);
  }
}

/**
 * Claim the right to replace the lock currently stored at `lockDir`.
 *
 * A plain rename is atomic, but it is not conditional: a contender that
 * inspected an old owner can execute its rename after another contender has
 * already installed a new lock at the same path. The exclusive file inside
 * the current directory turns takeover into a claim-and-recheck protocol.
 */
async function tryClaimTakeover(lockDir: string): Promise<string | undefined> {
  const token = randomUUID();
  try {
    await writeFile(join(lockDir, TAKEOVER_CLAIM_FILE), token, { encoding: "utf8", flag: "wx" });
    return token;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT" || code === "ENOTDIR" || code === "EPERM" || code === "EBUSY") return undefined;
    throw error;
  }
}

async function releaseTakeoverClaim(lockDir: string, token: string): Promise<void> {
  const path = join(lockDir, TAKEOVER_CLAIM_FILE);
  try {
    if ((await readFile(path, "utf8")) === token) {
      await rm(path, { force: true });
    }
  } catch {
    // The lock was renamed, removed or replaced. Never remove an unverified
    // claim from the new directory occupying the canonical path.
  }
}

async function readGeneration(mhDir: string): Promise<number> {
  try {
    const raw = await readFile(join(mhDir, GENERATION_FILE), "utf8");
    const parsed = JSON.parse(raw) as { generation?: unknown };
    return typeof parsed.generation === "number" && Number.isFinite(parsed.generation) ? parsed.generation : 0;
  } catch {
    return 0;
  }
}

async function readLockHeartbeatAt(lockDir: string, owner: RepoLockOwner): Promise<string | undefined> {
  if (owner.token === "") return undefined;
  try {
    const raw = await readFile(join(lockDir, heartbeatFileName(owner.token)), "utf8");
    const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown };
    if (parsed.token !== owner.token || typeof parsed.at !== "string") return undefined;
    return parsed.at;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

/**
 * Is the recorded owner still actively driving? Heartbeat-first: a fresh
 * token-scoped lock heartbeat means someone is actively renewing — the owner
 * is live no matter what PID inspection says (PIDs get recycled). Only when
 * the lock heartbeat is stale/absent do we fall back to same-process runner
 * registry, PID liveness and the owner run's persisted heartbeat.
 */
async function defaultOwnerIsLive(
  owner: RepoLockOwner,
  ctx: { lockDir: string; staleMs: number }
): Promise<boolean> {
  const beat = await readLockHeartbeatAt(ctx.lockDir, owner);
  if (beat !== undefined) {
    const age = Date.now() - new Date(beat).getTime();
    if (Number.isFinite(age) && age >= 0 && age < ctx.staleMs) return true;
    if (Number.isFinite(age) && age >= ctx.staleMs) {
      // The holder was renewing and stopped: treat as orphaned regardless of
      // PID (the process may survive its run, or the PID may be recycled).
      if (owner.pid === process.pid) return isRunnerActive(owner.runId);
      return false;
    }
  }
  if (owner.pid === process.pid) {
    return isRunnerActive(owner.runId);
  }
  if (!isProcessAlive(owner.pid)) {
    return false;
  }
  const run = await getRunRepository()
    .get(owner.runId)
    .catch(() => null);
  if (run === null) return false;
  const live = ["planning", "running", "waiting_for_input", "paused", "cancelling", "delivering"].includes(run.projection.lifecycle);
  if (!live) return false;
  const lastBeat = new Date(run.heartbeatAt ?? run.updatedAt).getTime();
  return Number.isFinite(lastBeat) && Date.now() - lastBeat < ctx.staleMs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function acquireRepoLock(
  repoRoot: string,
  runId: string,
  deps: RepoLockDeps = {}
): Promise<RepoLockResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const staleMs = deps.staleMs ?? DEFAULT_STALE_MS;
  const resolveLockBase = deps.resolveLockBase ?? defaultResolveLockBase;
  const mhDir = await resolveLockBase(repoRoot);
  const lockDir = join(mhDir, LOCK_DIR_NAME);
  await mkdir(mhDir, { recursive: true });
  const ownerIsLive =
    deps.ownerIsLive ?? ((owner: RepoLockOwner) => defaultOwnerIsLive(owner, { lockDir, staleMs }));

  let staleGeneration = 0;
  let stolen = false;
  const deadline = Date.now() + ACQUIRE_DEADLINE_MS;
  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS && Date.now() < deadline; attempt += 1) {
    try {
      await mkdir(lockDir);
      // Slot won: mint the immutable identity while holding exclusivity.
      const generation = Math.max(await readGeneration(mhDir), staleGeneration) + 1;
      const owner: RepoLockOwner = { runId, pid: process.pid, token: randomUUID(), generation, acquiredAt: now() };
      try {
        await writeJsonAtomic(join(lockDir, "owner.json"), owner);
        await writeJsonAtomic(join(lockDir, heartbeatFileName(owner.token)), { token: owner.token, at: now() });
        await writeJsonAtomic(join(mhDir, GENERATION_FILE), { generation });
      } catch {
        continue; // Quarantined mid-write by a racing takeover: re-race.
      }
      // Read-back verification: if a takeover with a stale judgment renamed
      // our directory away between the writes, detect it before handing out
      // the lease instead of returning a phantom owner.
      const verified = await readOwnerRecordAt(lockDir);
      if (verified?.token !== owner.token) {
        continue;
      }
      return {
        acquired: true,
        stolen,
        lease: {
          repoRoot,
          lockDir,
          runId,
          pid: owner.pid,
          token: owner.token,
          generation,
          acquiredAt: owner.acquiredAt
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const owner = await readOwnerWithGrace(lockDir);
    if (owner !== undefined) {
      if (await ownerIsLive(owner)) {
        return { acquired: false, owner };
      }
      staleGeneration = Math.max(staleGeneration, owner.generation);
    }

    // Stale, corrupt or abandoned: atomic takeover. Re-check the owner
    // immediately before the rename so we never quarantine a lock that was
    // already replaced by a fresh winner, then rename into a quarantine name
    // — exactly one contender wins the rename, the rest observe ENOENT.
    const takeoverClaim = await tryClaimTakeover(lockDir);
    if (takeoverClaim === undefined) {
      // Legacy single-file locks cannot contain a claim. Keep their one-time
      // transition path; every productive lock uses the directory protocol.
      let legacy = false;
      try {
        legacy = !(await stat(lockDir)).isDirectory();
      } catch {
        // The lock changed while contending; re-race the canonical slot.
      }
      if (!legacy) {
        await sleep(5 + Math.floor(Math.random() * 20));
        continue;
      }
    } else {
      // A late contender can create its claim inside a replacement directory.
      // Judge the owner again only after the exclusive claim is held.
      const claimedOwner = await readOwnerWithGrace(lockDir);
      if (claimedOwner !== undefined) {
        if (owner === undefined || claimedOwner.token !== owner.token || claimedOwner.generation !== owner.generation) {
          await releaseTakeoverClaim(lockDir, takeoverClaim);
          continue;
        }
        if (await ownerIsLive(claimedOwner)) {
          await releaseTakeoverClaim(lockDir, takeoverClaim);
          return { acquired: false, owner: claimedOwner };
        }
        staleGeneration = Math.max(staleGeneration, claimedOwner.generation);
      }
    }
    const quarantine = join(mhDir, `${LOCK_DIR_NAME}.stale-${randomUUID().slice(0, 8)}`);
    try {
      await rename(lockDir, quarantine);
      stolen = true;
      await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
    } catch {
      if (takeoverClaim !== undefined) {
        await releaseTakeoverClaim(lockDir, takeoverClaim);
      }
      await sleep(5 + Math.floor(Math.random() * 20));
    }
  }

  const owner = await readOwnerWithGrace(lockDir);
  return owner !== undefined
    ? { acquired: false, owner }
    : { acquired: false, owner: { runId: "unknown", pid: -1, token: "", generation: 0, acquiredAt: now() } };
}

export async function readRepoLock(
  repoRoot: string,
  deps: Pick<RepoLockDeps, "resolveLockBase"> = {}
): Promise<RepoLockOwner | undefined> {
  const resolveLockBase = deps.resolveLockBase ?? defaultResolveLockBase;
  const lockBase = await resolveLockBase(repoRoot);
  return readOwnerRecordAt(join(lockBase, LOCK_DIR_NAME));
}

/**
 * Renew the lease heartbeat. Token-checked: a superseded lease learns it is
 * lost instead of refreshing a foreign owner's lock.
 */
export async function renewRepoLease(
  lease: RepoLease,
  at: string = new Date().toISOString()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const owner = await readOwnerRecordAt(lease.lockDir);
  if (owner === undefined) return { ok: false, reason: "lock is gone" };
  if (owner.token !== lease.token) return { ok: false, reason: `lock is now owned by run ${owner.runId}` };
  try {
    await writeJsonAtomic(join(lease.lockDir, heartbeatFileName(lease.token)), { token: lease.token, at });
  } catch {
    return { ok: false, reason: "lock directory disappeared during renewal" };
  }
  return { ok: true };
}

export interface RepoLeaseHeartbeatOptions {
  intervalMs?: number;
  onBeat?: (at: string) => void;
  onLost?: (reason: string) => void;
}

/** Keep the lease fresh in the background. Stops itself if the lease is lost. */
export function startRepoLeaseHeartbeat(lease: RepoLease, options: RepoLeaseHeartbeatOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  let stopped = false;
  const emitBeat = (at: string): void => {
    try {
      options.onBeat?.(at);
    } catch {
      // Observability cannot prevent a lease from keeping its durable pulse.
    }
  };
  // acquireRepoLock persisted this token-scoped heartbeat before returning the
  // lease. Reporting it synchronously gives observers the same immediate
  // liveness fact and does not depend on the event loop reaching a timer.
  emitBeat(lease.acquiredAt);
  const tick = async (): Promise<void> => {
    while (!stopped) {
      try {
        const at = new Date().toISOString();
        const result = await renewRepoLease(lease, at);
        // Re-check after the await: a stop() issued while the renew was in
        // flight must not surface a late beat to the caller.
        if (stopped) return;
        if (!result.ok) {
          options.onLost?.(result.reason);
          return;
        }
        emitBeat(at);
      } catch {
        // Transient FS error: keep trying; staleness needs a long silence.
      }
      await sleep(intervalMs);
    }
  };
  void tick();
  return () => {
    stopped = true;
  };
}

/**
 * Fencing check: verify the lease is still the current owner (token AND
 * generation) immediately before a side effect covered by the lease.
 */
export async function assertRepoLeaseCurrent(lease: RepoLease): Promise<void> {
  const owner = await readOwnerRecordAt(lease.lockDir);
  if (owner === undefined) {
    throw new RepoLeaseLostError(lease, "the lock no longer exists");
  }
  if (owner.token !== lease.token || owner.generation !== lease.generation) {
    throw new RepoLeaseLostError(
      lease,
      `the lock is now owned by run ${owner.runId} (generation ${owner.generation})`
    );
  }
}

/**
 * Release only when still owned by this lease — a late release from a
 * previous owner can never delete the current lock. If a takeover races the
 * release rename, the victim's lock is restored.
 */
export async function releaseRepoLease(lease: RepoLease): Promise<void> {
  const owner = await readOwnerRecordAt(lease.lockDir);
  if (owner === undefined || owner.token !== lease.token) return;

  const quarantine = `${lease.lockDir}.released-${lease.token.slice(0, 8)}`;
  try {
    await rename(lease.lockDir, quarantine);
  } catch {
    return; // Already gone or replaced under contention: nothing to release.
  }

  const captured = await readOwnerRecordAt(quarantine);
  if (captured !== undefined && captured.token !== lease.token) {
    // Pathological interleaving: a takeover replaced the lock between our
    // ownership check and the rename. Restore the rightful owner.
    for (let i = 0; i < RENAME_RETRIES; i += 1) {
      try {
        await rename(quarantine, lease.lockDir);
        return;
      } catch {
        await sleep(10 + Math.floor(Math.random() * 20));
      }
    }
    console.warn(
      `[RepoLock] Could not restore the lock of run ${captured.runId} after a release/takeover race; ` +
        `its lease will fail fencing (${quarantine}).`
    );
    return;
  }
  await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
}
