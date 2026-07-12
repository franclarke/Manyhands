import type { ChildProcess, SpawnOptions } from "node:child_process";

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

/** Anything with a pid and a kill switch (ChildProcess, pty adapters). */
export interface KillableProcess {
  pid?: number | undefined;
  kill(signal?: NodeJS.Signals | number): unknown;
}

/**
 * Kills an executor process and its descendants. On Windows a shelled CLI shim
 * often runs under cmd.exe/PowerShell, so child.kill only reaches the shell —
 * taskkill /t fells the tree. On POSIX the child is spawned detached (its own
 * process group), so kill(-pid) reaches every descendant; a plain SIGKILL to
 * the direct child would orphan whatever the CLI forked.
 */
export function killProcessTree(child: KillableProcess, spawnFn: SpawnFn): void {
  if (typeof child.pid !== "number") {
    child.kill("SIGKILL");
    return;
  }
  if (process.platform === "win32") {
    try {
      spawnFn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to a best-effort signal.
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Not a group leader (or already gone) — fall through to the direct kill.
    }
  }
  child.kill("SIGKILL");
}
