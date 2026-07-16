/**
 * RU1 (F2B-1/R2B-4) — OS process-table inspection for durable orphan kill.
 *
 * Cancellation after a server restart has no ChildProcess handles: it only has
 * durable evidence (pid + registeredAt). Before killing a durable pid it must
 * (a) verify identity — a pid whose OS creation time postdates our
 * registration belongs to somebody else (pid recycling) — and (b) enumerate
 * the descendant tree so the WHOLE tree can be verified dead, not just the
 * root (R2B-4).
 *
 * One snapshot serves both needs. Windows uses PowerShell CIM (wmic is gone
 * from current Windows 11); POSIX uses `ps`. Both are injectable for tests.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { killProcessTree, type SpawnFn } from "./kill";
import { spawn } from "node:child_process";

const execFileAsync = promisify(execFile);

export interface ProcessSnapshotEntry {
  pid: number;
  ppid?: number;
  /** OS process creation time in epoch ms, when the platform reports it. */
  createdAtMs?: number;
  /** Executable name (diagnostic; identity relies on creation time). */
  command?: string;
}

export type ProcessSnapshot = Map<number, ProcessSnapshotEntry>;

export interface ProcessInspector {
  snapshot(): Promise<ProcessSnapshot>;
}

export interface SnapshotDeps {
  runCommand?: (command: string, args: readonly string[]) => Promise<{ stdout: string }>;
  platform?: NodeJS.Platform;
  nowMs?: () => number;
}

const WINDOWS_SNAPSHOT_SCRIPT =
  "Get-CimInstance Win32_Process | ForEach-Object { " +
  "'{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, " +
  "$(if ($_.CreationDate) { [long]$_.CreationDate.ToUniversalTime().Subtract([datetime]'1970-01-01').TotalMilliseconds } else { '' }), " +
  "$_.Name }";

/** Full process table of this machine. Throws when the platform tool fails. */
export async function snapshotProcessTable(deps: SnapshotDeps = {}): Promise<ProcessSnapshot> {
  const platform = deps.platform ?? process.platform;
  const runCommand =
    deps.runCommand ??
    (async (command: string, args: readonly string[]) =>
      execFileAsync(command, [...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }));

  if (platform === "win32") {
    const { stdout } = await runCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      WINDOWS_SNAPSHOT_SCRIPT
    ]);
    return parseWindowsSnapshot(stdout);
  }

  const { stdout } = await runCommand("ps", ["-Ao", "pid=,ppid=,etimes=,comm="]);
  return parsePosixSnapshot(stdout, deps.nowMs ?? (() => Date.now()));
}

export function parseWindowsSnapshot(stdout: string): ProcessSnapshot {
  const snapshot: ProcessSnapshot = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const [pidRaw, ppidRaw, createdRaw, ...nameParts] = trimmed.split("|");
    const pid = Number.parseInt(pidRaw ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const ppid = Number.parseInt(ppidRaw ?? "", 10);
    const createdAtMs = Number.parseInt(createdRaw ?? "", 10);
    const command = nameParts.join("|").trim();
    snapshot.set(pid, {
      pid,
      ...(Number.isInteger(ppid) && ppid > 0 ? { ppid } : {}),
      ...(Number.isFinite(createdAtMs) && createdAtMs > 0 ? { createdAtMs } : {}),
      ...(command.length > 0 ? { command } : {})
    });
  }
  return snapshot;
}

export function parsePosixSnapshot(stdout: string, nowMs: () => number): ProcessSnapshot {
  const snapshot: ProcessSnapshot = new Map();
  const now = nowMs();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (match === null) continue;
    const pid = Number.parseInt(match[1]!, 10);
    const ppid = Number.parseInt(match[2]!, 10);
    const elapsedSeconds = Number.parseInt(match[3]!, 10);
    const command = match[4]!.trim();
    if (!Number.isInteger(pid) || pid <= 0) continue;
    snapshot.set(pid, {
      pid,
      ...(Number.isInteger(ppid) && ppid > 0 ? { ppid } : {}),
      ...(Number.isInteger(elapsedSeconds) && elapsedSeconds >= 0
        ? { createdAtMs: now - elapsedSeconds * 1_000 }
        : {}),
      ...(command.length > 0 ? { command } : {})
    });
  }
  return snapshot;
}

/** Transitive descendants of `rootPid` in the snapshot (cycle-safe, root excluded). */
export function descendantsOf(snapshot: ProcessSnapshot, rootPid: number): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const entry of snapshot.values()) {
    if (entry.ppid === undefined) continue;
    const siblings = childrenByParent.get(entry.ppid) ?? [];
    siblings.push(entry.pid);
    childrenByParent.set(entry.ppid, siblings);
  }
  const result: number[] = [];
  const seen = new Set<number>([rootPid]);
  const queue = [...(childrenByParent.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    result.push(pid);
    queue.push(...(childrenByParent.get(pid) ?? []));
  }
  return result.sort((left, right) => left - right);
}

/**
 * Kill the tree rooted at a bare pid (no ChildProcess handle — the durable
 * path after a restart). Windows: taskkill /t; POSIX: process-group kill with
 * a direct-signal fallback, matching the handle-based killProcessTree.
 */
export function killPidTree(pid: number, spawnFn: SpawnFn = spawn): Promise<boolean> {
  return killProcessTree(
    {
      pid,
      kill: (signal?: NodeJS.Signals | number) => process.kill(pid, signal ?? "SIGKILL")
    },
    spawnFn
  );
}
