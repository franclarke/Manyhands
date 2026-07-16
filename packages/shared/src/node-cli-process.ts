import { spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";

export interface ResolveCliBinaryPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  lookupCommand?: (binaryPath: string, env: NodeJS.ProcessEnv) => string[];
}

export interface ResolveCliProcessInvocationOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** @deprecated Structured argv is always shell-free. */
  useShell?: boolean;
}

export interface CliProcessInvocation {
  command: string;
  args: string[];
  shell: boolean;
  /** Required when the final cmd.exe command line is already escaped. */
  windowsVerbatimArguments?: boolean;
}

export type CliSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface KillableCliProcess {
  pid?: number | undefined;
  exitCode?: number | null | undefined;
  signalCode?: NodeJS.Signals | null | undefined;
  once?(event: "close", listener: () => void): unknown;
  kill(signal?: NodeJS.Signals | number): unknown;
}

export interface KillCliProcessTreeOptions {
  /** Maximum time to wait for the tree and its process handle to settle. */
  verifyTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Injectable liveness probes for deterministic tests. */
  isProcessAlive?: (pid: number) => boolean;
  isProcessGroupAlive?: (pid: number) => boolean;
}

const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];

/** Resolve a bare Windows CLI name to one concrete executable or batch shim. */
export function resolveCliBinaryPath(binaryPath: string, options: ResolveCliBinaryPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || isPathLike(binaryPath)) {
    return binaryPath;
  }

  const env = options.env ?? process.env;
  const candidates = (options.lookupCommand ?? lookupWindowsCommand)(binaryPath, env);
  const existing = candidates.filter((candidate) => candidate.length > 0 && existsSync(candidate));
  const usable = existing.length > 0 ? existing : candidates;
  return preferWindowsExecutable(usable) ?? binaryPath;
}

export function cliPathRequiresShell(binaryPath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;
  const extension = extname(binaryPath).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

/**
 * Build a DEP0190-free process invocation for a CLI.
 *
 * Windows batch shims require cmd.exe, but Node's `{ shell: true, args }`
 * concatenation is deprecated and injectable. Invoke ComSpec directly and
 * provide one fully escaped command line instead.
 */
export function resolveCliProcessInvocation(
  binaryPath: string,
  args: readonly string[],
  options: ResolveCliProcessInvocationOptions = {}
): CliProcessInvocation {
  const platform = options.platform ?? process.platform;
  if (!cliPathRequiresShell(binaryPath, platform)) {
    return {
      command: binaryPath,
      args: [...args],
      shell: false
    };
  }

  const env = options.env ?? process.env;
  const escapedCommand = escapeWindowsCmdCommand(binaryPath);
  const escapedArgs = args.map(escapeWindowsCmdArgument);
  const commandLine = [escapedCommand, ...escapedArgs].join(" ");
  return {
    command: env.ComSpec?.trim() || "cmd.exe",
    // /v:off makes literal `!` deterministic even when delayed expansion was
    // enabled globally in the host's cmd.exe registry configuration.
    args: ["/d", "/v:off", "/s", "/c", `"${commandLine}"`],
    shell: false,
    windowsVerbatimArguments: true
  };
}

/**
 * Kill a CLI and its descendants after timeout/cancellation, then wait until
 * the OS command and the original process handle have settled. Returning from
 * a timeout before this barrier lets a stale agent keep writing while its
 * caller reads git diff, retries, or removes the worktree.
 */
export async function killCliProcessTree(
  child: KillableCliProcess,
  spawnFn: CliSpawnFn,
  platform: NodeJS.Platform = process.platform,
  options: KillCliProcessTreeOptions = {}
): Promise<boolean> {
  const verifyTimeoutMs = options.verifyTimeoutMs ?? 3_000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const isGroupAlive = options.isProcessGroupAlive ?? defaultIsProcessGroupAlive;

  if (typeof child.pid !== "number") {
    safeDirectKill(child);
    return waitForChildClose(child, verifyTimeoutMs);
  }
  const pid = child.pid;
  // A completed ChildProcess handle is authoritative for the process we
  // spawned. Do not send taskkill to a numeric pid that the OS may have reused.
  if (child.exitCode !== null && child.exitCode !== undefined) return true;
  if (child.signalCode !== null && child.signalCode !== undefined) return true;

  if (platform === "win32") {
    const childClosed = waitForChildClose(child, verifyTimeoutMs);
    // taskkill /t owns descendant enumeration. A zero exit plus the original
    // handle settling is the Windows tree-termination barrier.
    const firstTaskkillSucceeded = await runWindowsTaskkill(pid, spawnFn, verifyTimeoutMs);
    // Once the original Node process handle closes, it proves our process is
    // gone and releases the PID for reuse. Never probe or taskkill that numeric
    // PID again after this point: it may already identify somebody else's
    // process. (Before close, Windows keeps the process object/ID pinned.)
    const closed = (await childClosed) || (await waitForChildClose(child, 0));
    if (closed) return firstTaskkillSucceeded;

    if (!firstTaskkillSucceeded) {
      // The original handle is still open, so Windows has not reused this PID.
      const retrySucceeded = await runWindowsTaskkill(pid, spawnFn, verifyTimeoutMs);
      if (!retrySucceeded) safeDirectKill(child);
      const closedAfterRetry = await waitForChildClose(child, verifyTimeoutMs);
      return retrySucceeded && closedAfterRetry;
    }

    const dead = await waitUntil(() => !isAlive(pid), verifyTimeoutMs, pollIntervalMs);
    if (dead) {
      return waitForChildClose(child, verifyTimeoutMs);
    }

    if (!dead) {
      // Retry once. A transient taskkill failure must not silently turn a hard
      // timeout into a stale writer racing the orchestrator.
      const retrySucceeded = await runWindowsTaskkill(pid, spawnFn, verifyTimeoutMs);
      if (!retrySucceeded) safeDirectKill(child);
    }
    const closedAfterRetry = await waitForChildClose(child, verifyTimeoutMs);
    if (closedAfterRetry) return true;
    return false;
  }

  const childClosed = waitForChildClose(child, verifyTimeoutMs);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    safeDirectKill(child);
  }
  let groupDead = await waitUntil(() => !isGroupAlive(pid), verifyTimeoutMs, pollIntervalMs);
  if (!groupDead) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      safeDirectKill(child);
    }
    groupDead = await waitUntil(() => !isGroupAlive(pid), verifyTimeoutMs, pollIntervalMs);
  }
  const closed = await childClosed;
  return groupDead && closed;
}

async function runWindowsTaskkill(
  pid: number,
  spawnFn: CliSpawnFn,
  timeoutMs: number
): Promise<boolean> {
  try {
    const taskkill = spawnFn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      shell: false
    });
    const settled = await waitForChildClose(taskkill, timeoutMs);
    return settled && taskkill.exitCode === 0;
  } catch {
    return false;
  }
}

function safeDirectKill(child: KillableCliProcess): void {
  try {
    child.kill("SIGKILL");
  } catch {
    // Verification below remains authoritative; killing an already-dead
    // process commonly throws and is still a successful terminal state.
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultIsProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForChildClose(child: KillableCliProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve(true);
  if (child.signalCode !== null && child.signalCode !== undefined) return Promise.resolve(true);
  if (typeof child.once !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), Math.max(timeoutMs, 0));
    child.once!("close", () => finish(true));
  });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + Math.max(timeoutMs, 0);
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.max(pollIntervalMs, 1)));
  }
  return predicate();
}

const WINDOWS_CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/gu;

function escapeWindowsCmdCommand(value: string): string {
  return value.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
}

function escapeWindowsCmdArgument(value: string): string {
  let escaped = value;
  escaped = escaped.replace(/(?=(\\+?)?)\1"/gu, "$1$1\\\"");
  escaped = escaped.replace(/(?=(\\+?)?)\1$/gu, "$1$1");
  escaped = `"${escaped}"`;
  // npm-style batch launchers forward argv through `%*`, causing a second
  // cmd.exe parse. Escaping both passes prevents metacharacters from becoming
  // commands during that expansion.
  escaped = escaped.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
  return escaped.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
}

function isPathLike(binaryPath: string): boolean {
  return isAbsolute(binaryPath) || binaryPath.includes("/") || binaryPath.includes("\\");
}

function preferWindowsExecutable(candidates: readonly string[]): string | undefined {
  for (const extension of WINDOWS_EXECUTABLE_EXTENSIONS) {
    const match = candidates.find((candidate) => extname(candidate).toLowerCase() === extension);
    if (match !== undefined) return match;
  }
  return candidates[0];
}

function lookupWindowsCommand(binaryPath: string, env: NodeJS.ProcessEnv): string[] {
  const where = spawnSync("where.exe", [binaryPath], {
    encoding: "utf8",
    env,
    windowsHide: true
  });
  if (where.status === 0 && where.stdout.trim().length > 0) {
    return where.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return lookupWindowsPath(binaryPath, env);
}

function lookupWindowsPath(binaryPath: string, env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.Path ?? env.PATH ?? "";
  const pathext = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const requestedExtension = extname(binaryPath).toLowerCase();
  const extensions = requestedExtension.length > 0 ? [""] : pathext;
  const matches: string[] = [];
  for (const dir of pathValue.split(delimiter).filter((value) => value.length > 0)) {
    for (const extension of extensions) {
      const candidate = join(dir, `${binaryPath}${extension}`);
      if (existsSync(candidate)) matches.push(candidate);
    }
  }
  return matches;
}
