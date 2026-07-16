/**
 * Live subprocess registry + verified kill (INV-2, B-005 ProcessSupervisor).
 *
 * Every productive subprocess of a run — executor CLIs, planning decomposers,
 * validation commands, dependency installs, git helpers, terminal shells —
 * registers here under its owner (the runId), with metadata naming the phase
 * (`label`) and the owning operation. Cancellation then has one authority to
 * act on: after the cooperative AbortSignal fires, `killOwnedProcessTrees`
 * force-kills whatever is still registered and POLLS the root PIDs until they
 * are verified dead (re-killing once if a tree survives the first attempt).
 * The cancel endpoint awaits this, so a terminal cancel means "no process of
 * this run can write anymore", not "we asked nicely".
 */
import { spawn, type ChildProcess } from "node:child_process";

import { execWarn } from "../logging/log";
import { killProcessTree, type SpawnFn } from "./kill";

/**
 * Minimal shape the supervisor needs. `ChildProcess` satisfies it; pty
 * processes are adapted by their owners (they expose pid + kill).
 */
export interface SupervisedProcessHandle {
  pid?: number | undefined;
  kill(signal?: NodeJS.Signals | number): unknown;
}

/** Who a supervised process belongs to and which phase spawned it. */
export interface SupervisedProcessMeta {
  runId: string;
  attemptId?: string;
  /** Phase label: "executor", "planning", "validation", "install", "git", "terminal", … */
  label: string;
  operationId?: string;
}

const liveProcesses = new Map<string, Set<SupervisedProcessHandle>>();
const processMetas = new WeakMap<SupervisedProcessHandle, SupervisedProcessMeta>();

/**
 * RU1 (F2B-1): durable evidence hook. The in-memory registry dies with the
 * process, so cancellation after a server restart cannot see orphans. A host
 * app installs a sink here; every registration/exit is mirrored to it so a
 * fresh process can later find, verify and kill what this one spawned.
 */
export interface ProcessEvidenceEvent {
  ownerId: string;
  pid?: number;
  label: string;
  /** Executable name/path when the handle exposes it (never full argv). */
  command?: string;
  attemptId?: string;
  operationId?: string;
  at: string;
}

export interface ProcessEvidenceSink {
  processRegistered(event: ProcessEvidenceEvent): void;
  processExited(event: { ownerId: string; pid?: number; at: string }): void;
}

let evidenceSink: ProcessEvidenceSink | undefined;

export function setProcessEvidenceSink(sink: ProcessEvidenceSink | undefined): void {
  evidenceSink = sink;
}

export function registerLiveProcess(ownerId: string, child: SupervisedProcessHandle, meta?: SupervisedProcessMeta): void {
  let set = liveProcesses.get(ownerId);
  if (set === undefined) {
    set = new Set();
    liveProcesses.set(ownerId, set);
  }
  set.add(child);
  if (meta !== undefined) processMetas.set(child, meta);
  try {
    const command = (child as { spawnfile?: unknown }).spawnfile;
    evidenceSink?.processRegistered({
      ownerId,
      ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
      label: meta?.label ?? "process",
      ...(typeof command === "string" && command.length > 0 ? { command } : {}),
      ...(meta?.attemptId !== undefined ? { attemptId: meta.attemptId } : {}),
      ...(meta?.operationId !== undefined ? { operationId: meta.operationId } : {}),
      at: new Date().toISOString()
    });
  } catch (error) {
    execWarn("supervisor", "process evidence sink failed on register", {
      ownerId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export function unregisterLiveProcess(ownerId: string, child: SupervisedProcessHandle): void {
  const set = liveProcesses.get(ownerId);
  if (set === undefined) return;
  set.delete(child);
  if (set.size === 0) {
    liveProcesses.delete(ownerId);
  }
  try {
    evidenceSink?.processExited({
      ownerId,
      ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
      at: new Date().toISOString()
    });
  } catch (error) {
    execWarn("supervisor", "process evidence sink failed on exit", {
      ownerId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

/** Pids + metadata of the processes currently registered under an owner. */
export function listLiveProcessMetas(
  ownerId: string
): Array<{ pid?: number; label?: string; attemptId?: string; operationId?: string }> {
  return Array.from(liveProcesses.get(ownerId) ?? [], (child) => {
    const meta = processMetas.get(child);
    return {
      ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
      ...(meta?.label !== undefined ? { label: meta.label } : {}),
      ...(meta?.attemptId !== undefined ? { attemptId: meta.attemptId } : {}),
      ...(meta?.operationId !== undefined ? { operationId: meta.operationId } : {})
    };
  });
}

export interface SuperviseOptions {
  /** Cooperative cancellation: aborting kills the supervised process tree. */
  signal?: AbortSignal;
  /** Spawn used for the tree kill (taskkill on win32). Injectable for tests. */
  spawnFn?: SpawnFn;
}

/**
 * Register a process under its run with metadata, wire the AbortSignal to a
 * tree kill, and auto-unregister on exit (for ChildProcess handles). Returns
 * a disposer; owners of non-ChildProcess handles (pty) MUST call it when
 * their process exits.
 */
export function superviseChildProcess(
  meta: SupervisedProcessMeta,
  child: SupervisedProcessHandle,
  options: SuperviseOptions = {}
): () => void {
  registerLiveProcess(meta.runId, child, meta);
  processMetas.set(child, meta);

  const spawnFn = options.spawnFn ?? spawn;
  const onAbort = (): void => {
    void killProcessTree(child, spawnFn);
  };
  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    options.signal?.removeEventListener("abort", onAbort);
    unregisterLiveProcess(meta.runId, child);
  };

  const maybeChildProcess = child as ChildProcess;
  if (typeof maybeChildProcess.once === "function") {
    // 'close' fires on every exit path (clean, timeout-kill, abort-kill).
    maybeChildProcess.once("close", dispose);
  }
  return dispose;
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
   * unverified: the pid appears alive but its identity could not be confirmed
   * (RU1): killing it would risk a recycled pid, so the caller must NOT claim
   * allDead and must NOT kill it.
   */
  outcome: "dead" | "escalated" | "survived" | "unverified";
  waitedMs: number;
  /** Phase that spawned the process, when it was supervised with metadata. */
  label?: string;
  operationId?: string;
  attemptId?: string;
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
  child: SupervisedProcessHandle,
  spawnFn: SpawnFn,
  timeoutMs = 3_000
): Promise<KillVerification> {
  const start = Date.now();
  const pid = child.pid;
  const meta = processMetas.get(child);
  const withMeta = (verification: KillVerification): KillVerification => ({
    ...verification,
    ...(meta !== undefined
      ? {
          label: meta.label,
          ...(meta.operationId !== undefined ? { operationId: meta.operationId } : {}),
          ...(meta.attemptId !== undefined ? { attemptId: meta.attemptId } : {})
        }
      : {})
  });
  if (typeof pid !== "number" || !isProcessAlive(pid)) {
    return withMeta({ pid: pid ?? -1, outcome: "dead", waitedMs: 0 });
  }

  await killProcessTree(child, spawnFn);
  if (await waitUntilDead(pid, timeoutMs / 2)) {
    return withMeta({ pid, outcome: "dead", waitedMs: Date.now() - start });
  }

  execWarn("cancel", "process tree survived first kill — escalating", { pid });
  await killProcessTree(child, spawnFn);
  if (await waitUntilDead(pid, timeoutMs / 2)) {
    return withMeta({ pid, outcome: "escalated", waitedMs: Date.now() - start });
  }

  execWarn("cancel", "process tree SURVIVED verified kill", { pid });
  return withMeta({ pid, outcome: "survived", waitedMs: Date.now() - start });
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
