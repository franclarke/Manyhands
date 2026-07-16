import type { ChildProcess, SpawnOptions } from "node:child_process";
import { killCliProcessTree } from "@manyhands/shared/node-cli-process";

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

/** Anything with a pid and a kill switch (ChildProcess, pty adapters). */
export interface KillableProcess {
  pid?: number | undefined;
  exitCode?: number | null | undefined;
  signalCode?: NodeJS.Signals | null | undefined;
  once?(event: "close", listener: () => void): unknown;
  kill(signal?: NodeJS.Signals | number): unknown;
}

/**
 * Kill an executor process tree and wait for its OS termination barrier.
 * Windows waits for taskkill /t plus the original process handle; POSIX waits
 * for both the detached process group and the original handle to disappear.
 */
export function killProcessTree(child: KillableProcess, spawnFn: SpawnFn): Promise<boolean> {
  return killCliProcessTree(child, spawnFn);
}
