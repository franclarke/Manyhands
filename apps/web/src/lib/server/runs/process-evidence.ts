/**
 * RU1 (F2B-1/R2B-4) — durable process evidence + merged verified kill.
 *
 * The live-process registry is in-memory: it dies with the Next process, so a
 * cancel issued after a restart (or from another process) used to see nothing,
 * report a vacuous `allDead=true` and mark the run `interrupted` while orphan
 * executors kept mutating their worktrees.
 *
 * This module closes that hole with three pieces:
 *
 *  1. `JsonRunProcessJournal` — one JSON sidecar per run
 *     (`.manyhands/runs/processes/<runId>.json`) recording every supervised
 *     process as soon as its identity is known, closed again on normal exit.
 *  2. `installProcessEvidenceSink()` — wires the execution-core supervisor to
 *     the journal (fire-and-forget; evidence must never block a spawn).
 *  3. `killRunProcessesVerified(runId)` — the cancel-side kill: merges the
 *     live registry with still-open durable evidence, verifies IDENTITY before
 *     killing a durable pid (OS creation time must not postdate registration —
 *     otherwise the pid was recycled and belongs to somebody else), kills the
 *     process TREE, verifies root AND descendants dead, and only closes the
 *     evidence it could verify. An unverifiable-but-alive pid is reported as
 *     `unverified` and blocks `allDead` — no false certainty (invariant 8).
 *
 * Historic compatibility: a run without a journal file simply has no durable
 * candidates — absence of metadata is NOT evidence of a live process.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  descendantsOf,
  isProcessAlive,
  killOwnedProcessTrees,
  killPidTree,
  listLiveProcessMetas,
  setProcessEvidenceSink,
  snapshotProcessTable,
  type KillReport,
  type KillVerification,
  type ProcessInspector,
  type ProcessSnapshot
} from "@manyhands/execution-core";
import { atomicWriteJson } from "../workspaces/atomic-write";
import { globalSingleton, resetGlobalSingleton } from "../global-singleton";
import { resolveRunsDirectory } from "./runs-directory";

const RunProcessRecordSchema = z.object({
  pid: z.number().int().positive().optional(),
  label: z.string().min(1),
  command: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional(),
  operationId: z.string().min(1).optional(),
  registeredAt: z.string().min(1),
  exitedAt: z.string().min(1).optional(),
  closed: z.object({ at: z.string().min(1), reason: z.string().min(1) }).optional()
});

export type RunProcessRecord = z.infer<typeof RunProcessRecordSchema>;

const RunProcessFileSchema = z.object({
  version: z.literal(1),
  processes: z.array(RunProcessRecordSchema),
  updatedAt: z.string().min(1)
});

type RunProcessFile = z.infer<typeof RunProcessFileSchema>;

function isOpen(record: RunProcessRecord): boolean {
  return record.exitedAt === undefined && record.closed === undefined;
}

export interface JsonRunProcessJournalOptions {
  /** Defaults to `<runsDir>/processes`, resolved per operation (env-aware). */
  directory?: string;
  clock?: () => string;
}

export class JsonRunProcessJournal {
  private readonly directoryOverride: string | undefined;
  private readonly clock: () => string;
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(options: JsonRunProcessJournalOptions = {}) {
    this.directoryOverride = options.directory;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async recordStart(
    runId: string,
    input: {
      pid?: number;
      label: string;
      command?: string;
      attemptId?: string;
      operationId?: string;
      registeredAt?: string;
    }
  ): Promise<RunProcessRecord> {
    const record = RunProcessRecordSchema.parse({
      ...(input.pid !== undefined ? { pid: input.pid } : {}),
      label: input.label,
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
      ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
      registeredAt: input.registeredAt ?? this.clock()
    });
    await this.mutate(runId, (file) => ({ ...file, processes: [...file.processes, record] }));
    return record;
  }

  /** Close the newest open entry for `pid` as a normal exit. Unknown pid: no-op. */
  async recordExit(runId: string, pid: number, at?: string): Promise<void> {
    await this.mutate(runId, (file) => {
      const index = findNewestOpenIndex(file.processes, pid);
      if (index < 0) return file;
      const processes = [...file.processes];
      processes[index] = { ...processes[index]!, exitedAt: at ?? this.clock() };
      return { ...file, processes };
    });
  }

  /** Close a specific entry (identified by pid+registeredAt) with a reason. Idempotent. */
  async close(runId: string, pid: number, registeredAt: string, reason: string): Promise<void> {
    await this.mutate(runId, (file) => {
      const index = file.processes.findIndex(
        (record) => record.pid === pid && record.registeredAt === registeredAt
      );
      if (index < 0 || !isOpen(file.processes[index]!)) return file;
      const processes = [...file.processes];
      processes[index] = { ...processes[index]!, closed: { at: this.clock(), reason } };
      return { ...file, processes };
    });
  }

  async list(runId: string): Promise<RunProcessRecord[]> {
    return (await this.readFile(runId)).processes;
  }

  async listOpen(runId: string): Promise<RunProcessRecord[]> {
    return (await this.readFile(runId)).processes.filter(isOpen);
  }

  private directory(): string {
    return this.directoryOverride ?? path.join(resolveRunsDirectory(), "processes");
  }

  private filePath(runId: string): string {
    return path.join(this.directory(), `${safeName(runId)}.json`);
  }

  private async readFile(runId: string): Promise<RunProcessFile> {
    try {
      return RunProcessFileSchema.parse(JSON.parse(await readFile(this.filePath(runId), "utf8")));
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") {
        return { version: 1, processes: [], updatedAt: this.clock() };
      }
      throw error;
    }
  }

  private async mutate(
    runId: string,
    mutator: (file: RunProcessFile) => RunProcessFile
  ): Promise<void> {
    await this.withRunLock(runId, async () => {
      const current = await this.readFile(runId);
      const next = mutator(current);
      if (next === current) return;
      await mkdir(this.directory(), { recursive: true });
      await atomicWriteJson(this.filePath(runId), { ...next, updatedAt: this.clock() });
    });
  }

  private withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(runId) ?? Promise.resolve();
    const next = previous.then(
      () => this.withFilesystemLock(runId, operation),
      () => this.withFilesystemLock(runId, operation)
    );
    this.writeChains.set(runId, next.catch(() => undefined));
    return next;
  }

  /** Same cross-process mutex pattern as the attempt journal (mkdir + stale eviction). */
  private async withFilesystemLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const locks = path.join(this.directory(), ".mutation-locks");
    const lock = path.join(locks, safeName(runId));
    await mkdir(locks, { recursive: true });
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        await mkdir(lock);
        await writeFile(path.join(lock, "owner"), `${process.pid}\n${Date.now()}`, "utf8");
        break;
      } catch (error) {
        if (!isErrno(error) || error.code !== "EEXIST") throw error;
        const info = await stat(lock).catch(() => undefined);
        if (info !== undefined && Date.now() - info.mtimeMs > 30_000) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) throw new Error(`Timed out locking process journal for ${runId}.`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try {
      return await operation();
    } finally {
      await rm(lock, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function findNewestOpenIndex(processes: readonly RunProcessRecord[], pid: number): number {
  for (let index = processes.length - 1; index >= 0; index -= 1) {
    const record = processes[index]!;
    if (record.pid === pid && isOpen(record)) return index;
  }
  return -1;
}

// ── Sink wiring (supervisor → journal) ──────────────────────────────────────

// Fire-and-forget writes tracked so tests can drain before restoring env vars.
const pendingEvidenceWrites = globalSingleton(
  "process-evidence:pending-writes",
  () => new Set<Promise<unknown>>()
);

function trackEvidenceWrite(write: Promise<unknown>): void {
  const tracked = write.catch(() => undefined).finally(() => pendingEvidenceWrites.delete(tracked));
  pendingEvidenceWrites.add(tracked);
}

/**
 * Install the durable evidence sink over the execution-core supervisor.
 * Idempotent per process; resolves the runs directory per event so tests that
 * swap MANYHANDS_RUNS_DIR are honored.
 */
export function installProcessEvidenceSink(): void {
  globalSingleton("process-evidence:sink-installed", () => {
    const journal = new JsonRunProcessJournal();
    setProcessEvidenceSink({
      processRegistered: (event) => {
        trackEvidenceWrite(
          journal.recordStart(event.ownerId, {
            ...(event.pid !== undefined ? { pid: event.pid } : {}),
            label: event.label,
            ...(event.command !== undefined ? { command: event.command } : {}),
            ...(event.attemptId !== undefined ? { attemptId: event.attemptId } : {}),
            ...(event.operationId !== undefined ? { operationId: event.operationId } : {}),
            registeredAt: event.at
          })
        );
      },
      processExited: (event) => {
        if (event.pid === undefined) return;
        trackEvidenceWrite(journal.recordExit(event.ownerId, event.pid, event.at));
      }
    });
    return true;
  });
}

export function uninstallProcessEvidenceSinkForTests(): void {
  resetGlobalSingleton("process-evidence:sink-installed");
  setProcessEvidenceSink(undefined);
}

export async function drainProcessEvidenceForTests(): Promise<void> {
  while (pendingEvidenceWrites.size > 0) {
    await Promise.allSettled(Array.from(pendingEvidenceWrites));
  }
}

// ── Merged verified kill (cancel path) ──────────────────────────────────────

export interface KillRunProcessesDeps {
  journal?: JsonRunProcessJournal;
  inspector?: ProcessInspector;
  /** In-memory registry kill (handles + abort listeners). */
  killOwned?: (ownerId: string) => Promise<KillReport>;
  /** Tree kill for a bare durable pid. */
  killPidTree?: (pid: number) => void | Promise<void>;
  isAlive?: (pid: number) => boolean;
  nowMs?: () => number;
  /** Clock-skew tolerance for the creation-time identity check. */
  skewMs?: number;
  killTimeoutMs?: number;
}

/**
 * Kill everything the run may still be running: live registry handles AND
 * durable evidence that survived a restart. `allDead` is true only when every
 * verification (roots and descendants, live and durable) is dead/escalated —
 * an empty in-memory registry alone proves nothing (F2B-1).
 */
export async function killRunProcessesVerified(
  runId: string,
  deps: KillRunProcessesDeps = {}
): Promise<KillReport> {
  const journal = deps.journal ?? new JsonRunProcessJournal();
  const inspector = deps.inspector ?? { snapshot: () => snapshotProcessTable() };
  const killOwned = deps.killOwned ?? ((ownerId: string) => killOwnedProcessTrees(ownerId));
  const killTree = deps.killPidTree ?? ((pid: number) => killPidTree(pid));
  const isAlive = deps.isAlive ?? isProcessAlive;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const skewMs = deps.skewMs ?? 5_000;
  const killTimeoutMs = deps.killTimeoutMs ?? 3_000;

  const openEvidence = await journal.listOpen(runId);
  const livePidsBeforeKill = listLiveProcessMetas(runId)
    .map((entry) => entry.pid)
    .filter((pid): pid is number => typeof pid === "number");

  // One snapshot BEFORE any kill: identity for durable pids + descendant trees
  // for every root (live and durable).
  let snapshot: ProcessSnapshot | undefined;
  if (openEvidence.length > 0 || livePidsBeforeKill.length > 0) {
    try {
      snapshot = await inspector.snapshot();
    } catch {
      snapshot = undefined;
    }
  }

  const verifications: KillVerification[] = [];

  // 1) Live registry handles (same behavior as before RU1).
  const liveReport = await killOwned(runId);
  verifications.push(...liveReport.verifications);
  const liveKilledPids = new Set(liveReport.verifications.map((verification) => verification.pid));

  // 2) Durable evidence not covered by the live kill.
  for (const record of openEvidence) {
    if (record.pid === undefined) {
      await journal.close(runId, -1, record.registeredAt, "no_pid").catch(() => undefined);
      continue;
    }
    const pid = record.pid;

    if (liveKilledPids.has(pid)) {
      // The live path already killed and verified this pid; close the evidence
      // if the verification says it is gone.
      const liveOutcome = liveReport.verifications.find((verification) => verification.pid === pid);
      if (liveOutcome !== undefined && liveOutcome.outcome !== "survived") {
        await journal.close(runId, pid, record.registeredAt, "killed");
      }
      continue;
    }

    if (snapshot === undefined) {
      // No process table available: never kill blind, never claim certainty.
      if (!isAlive(pid)) {
        await journal.close(runId, pid, record.registeredAt, "not_running");
        verifications.push(withLabel({ pid, outcome: "dead", waitedMs: 0 }, record));
      } else {
        verifications.push(withLabel({ pid, outcome: "unverified", waitedMs: 0 }, record));
      }
      continue;
    }

    const entry = snapshot.get(pid);
    if (entry === undefined) {
      await journal.close(runId, pid, record.registeredAt, "not_running");
      verifications.push(withLabel({ pid, outcome: "dead", waitedMs: 0 }, record));
      continue;
    }

    const registeredAtMs = Date.parse(record.registeredAt);
    if (
      entry.createdAtMs !== undefined &&
      Number.isFinite(registeredAtMs) &&
      entry.createdAtMs > registeredAtMs + skewMs
    ) {
      // The pid was recycled: the process we registered is provably gone and
      // this one belongs to somebody else. Refuse to kill it.
      await journal.close(runId, pid, record.registeredAt, "pid_recycled");
      verifications.push(withLabel({ pid, outcome: "dead", waitedMs: 0 }, record));
      continue;
    }

    if (entry.createdAtMs === undefined || !Number.isFinite(registeredAtMs)) {
      // Present in the table but identity not confirmable: no blind kill.
      verifications.push(withLabel({ pid, outcome: "unverified", waitedMs: 0 }, record));
      continue;
    }

    // Identity verified: kill the tree and verify root + descendants.
    const descendants = descendantsOf(snapshot, pid);
    const start = nowMs();
    await killTree(pid);
    let rootOutcome: KillVerification["outcome"] = "dead";
    if (!(await waitDead(pid, isAlive, killTimeoutMs / 2))) {
      await killTree(pid); // escalate once, like the in-memory verified kill
      rootOutcome = (await waitDead(pid, isAlive, killTimeoutMs / 2)) ? "escalated" : "survived";
    }
    verifications.push(withLabel({ pid, outcome: rootOutcome, waitedMs: nowMs() - start }, record));

    const survivingDescendants: number[] = [];
    for (const descendant of descendants) {
      if (!(await waitDead(descendant, isAlive, killTimeoutMs / 2))) {
        survivingDescendants.push(descendant);
        verifications.push({
          pid: descendant,
          outcome: "survived",
          waitedMs: nowMs() - start,
          label: `${record.label}:descendant`
        });
      }
    }

    if (rootOutcome !== "survived" && survivingDescendants.length === 0) {
      await journal.close(runId, pid, record.registeredAt, "killed");
    }
  }

  // 3) Descendant verification for live roots (R2B-4): the in-memory kill only
  //    verifies each root pid; check the trees it was supposed to fell.
  if (snapshot !== undefined) {
    const alreadyReported = new Set(verifications.map((verification) => verification.pid));
    for (const rootPid of livePidsBeforeKill) {
      for (const descendant of descendantsOf(snapshot, rootPid)) {
        if (alreadyReported.has(descendant)) continue;
        if (!(await waitDead(descendant, isAlive, killTimeoutMs / 2))) {
          alreadyReported.add(descendant);
          verifications.push({ pid: descendant, outcome: "survived", waitedMs: 0, label: "descendant" });
        }
      }
    }
  }

  return {
    ownerId: runId,
    verifications,
    allDead: verifications.every(
      (verification) => verification.outcome === "dead" || verification.outcome === "escalated"
    )
  };
}

function withLabel(
  verification: Omit<KillVerification, "label" | "attemptId" | "operationId">,
  record: RunProcessRecord
): KillVerification {
  return {
    ...verification,
    label: record.label,
    ...(record.attemptId !== undefined ? { attemptId: record.attemptId } : {}),
    ...(record.operationId !== undefined ? { operationId: record.operationId } : {})
  };
}

async function waitDead(
  pid: number,
  isAlive: (pid: number) => boolean,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + Math.max(timeoutMs, 0);
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isAlive(pid);
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isErrno(value: unknown): value is { code?: string } {
  return typeof value === "object" && value !== null && "code" in value;
}

export interface RunProcessPresenceDeps {
  journal?: Pick<JsonRunProcessJournal, "listOpen">;
  inspector?: ProcessInspector;
  isAlive?: (pid: number) => boolean;
  /** Clock-skew tolerance for the creation-time identity check. */
  skewMs?: number;
}

/**
 * Whether a process of this run is still plausibly alive — the read-only twin
 * of `killRunProcessesVerified`, for the liveness supervisor.
 *
 * Its errors are asymmetric, and the direction matters more than the accuracy.
 * A false "present" leaves an abandoned run hanging until the next sweep; a
 * false "absent" ends a run whose executor is mid-flight and destroys the work.
 * So every uncertain case answers present, and only positive evidence of
 * absence — no record, no pid in the table, a recycled pid, or a pid the OS
 * says is gone — answers absent.
 *
 * The identity rule is the kill path's, deliberately: a pid whose creation time
 * postdates our registration is somebody else's process, and treating it as
 * ours would keep an abandoned run alive forever on the strength of an
 * unrelated program.
 */
export async function hasLiveRunProcesses(
  runId: string,
  deps: RunProcessPresenceDeps = {}
): Promise<boolean> {
  const journal = deps.journal ?? new JsonRunProcessJournal();
  const inspector = deps.inspector ?? { snapshot: () => snapshotProcessTable() };
  const isAlive = deps.isAlive ?? isProcessAlive;
  const skewMs = deps.skewMs ?? 5_000;

  const open = await journal.listOpen(runId);
  const candidates = open.filter((record): record is typeof record & { pid: number } => record.pid !== undefined);
  // No durable candidate is genuine absence: evidence is written as soon as a
  // process identity is known, so a run that spawned anything has a record.
  if (candidates.length === 0) return false;

  let snapshot: ProcessSnapshot | undefined;
  try {
    snapshot = await inspector.snapshot();
  } catch {
    snapshot = undefined;
  }

  return candidates.some((record) => {
    if (snapshot === undefined) {
      // No table, so identity cannot be confirmed. A pid that is gone is still
      // provably gone; one that answers is unidentifiable, and unidentifiable
      // resolves to present.
      return isAlive(record.pid);
    }
    const entry = snapshot.get(record.pid);
    if (entry === undefined) return false;
    const registeredAtMs = Date.parse(record.registeredAt);
    if (
      entry.createdAtMs !== undefined &&
      Number.isFinite(registeredAtMs) &&
      entry.createdAtMs > registeredAtMs + skewMs
    ) {
      return false;
    }
    return true;
  });
}
