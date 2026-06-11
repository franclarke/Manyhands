/**
 * Live subprocess registry + verified kill (INV-2).
 *
 * Every executor subprocess registers here under its owner (the runId) for as
 * long as it is alive. Cancellation then has an authority to act on: after the
 * cooperative AbortSignal fires, `killOwnedProcessTrees(ownerId)` force-kills
 * whatever is still registered and POLLS the root PIDs until they are verified
 * dead (re-killing once if a tree survives the first attempt). The cancel
 * endpoint awaits this, so "cancelled" means "no process of this run can write
 * anymore", not "we asked nicely".
 */
import { spawn, type ChildProcess } from "node:child_process";

import { execWarn } from "../logging/log";
import { killProcessTree, type SpawnFn } from "./kill";

const liveProcesses = new Map<string, Set<ChildProcess>>();

export function registerLiveProcess(ownerId: string, child: ChildProcess): void {
  let set = liveProcesses.get(ownerId);
  if (set === undefined) {
    set = new Set();
    liveProcesses.set(ownerId, set);
  }
  set.add(child);
}

export function unregisterLiveProcess(ownerId: string, child: ChildProcess): void {
  const set = liveProcesses.get(ownerId);
  if (set === undefined) return;
  set.delete(child);
  if (set.size === 0) {
    liveProcesses.delete(ownerId);
  }
}

export function countLiveProcesses(ownerId: string): number {
  return liveProcesses.get(ownerId)?.size ?? 0;
}

/** Signal-0 probe; works on win32 and POSIX for "does this PID exist". */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface KillVerification {
  pid: number;
  /**
   * dead: verified gone. escalated: survived the first kill, died after the
   * re-kill. survived: still alive after every attempt (caller must surface it).
   */
  outcome: "dead" | "escalated" | "survived";
  waitedMs: number;
}

export interface KillReport {
  ownerId: string;
  verifications: KillVerification[];
  /** True when every tracked process is verified dead. */
  allDead: boolean;
}

const POLL_INTERVAL_MS = 100;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return !isProcessAlive(pid);
}

/**
 * Kill one process tree and verify the root PID is gone, escalating with a
 * second kill if it survives the first window.
 */
export async function killProcessTreeVerified(
  child: ChildProcess,
  spawnFn: SpawnFn,
  timeoutMs = 3_000
): Promise<KillVerification> {
  const start = Date.now();
  const pid = child.pid;
  if (typeof pid !== "number" || !isProcessAlive(pid)) {
    return { pid: pid ?? -1, outcome: "dead", waitedMs: 0 };
  }

  killProcessTree(child, spawnFn);
  if (await waitUntilDead(pid, timeoutMs / 2)) {
    return { pid, outcome: "dead", waitedMs: Date.now() - start };
  }

  execWarn("cancel", "process tree survived first kill — escalating", { pid });
  killProcessTree(child, spawnFn);
  if (await waitUntilDead(pid, timeoutMs / 2)) {
    return { pid, outcome: "escalated", waitedMs: Date.now() - start };
  }

  execWarn("cancel", "process tree SURVIVED verified kill", { pid });
  return { pid, outcome: "survived", waitedMs: Date.now() - start };
}

/**
 * Force-kill every live process registered under `ownerId` and verify each
 * tree's root PID is gone. Idempotent: an owner with nothing registered
 * returns an empty, all-dead report.
 */
export async function killOwnedProcessTrees(
  ownerId: string,
  spawnFn: SpawnFn = spawn,
  timeoutMs = 3_000
): Promise<KillReport> {
  const children = Array.from(liveProcesses.get(ownerId) ?? []);
  const verifications = await Promise.all(
    children.map((child) => killProcessTreeVerified(child, spawnFn, timeoutMs))
  );
  return {
    ownerId,
    verifications,
    allDead: verifications.every((v) => v.outcome !== "survived")
  };
}
