/**
 * B-005 — web-side seam for the ProcessSupervisor.
 *
 * Planning-side spawns (decomposer CLIs, titler) and git helpers accept an
 * injectable spawn function; wrapping it here registers every child under its
 * run with a phase label and wires the run's AbortSignal, so cancellation can
 * kill and VERIFY the whole tree via `killOwnedProcessTrees(runId)`.
 *
 * Git helpers (final apply, repo provisioning) run whole call trees of short
 * `execFile("git", …)` invocations; those are covered by an ambient
 * AsyncLocalStorage context (`runWithProcessSupervision` +
 * `supervisedExecFile`) instead of threading a parameter through every helper.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  execFile,
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions
} from "node:child_process";
import { promisify } from "node:util";
import { superviseChildProcess, type SupervisedProcessMeta } from "@manyhands/execution-core";
import { installProcessEvidenceSink } from "./process-evidence";

// RU1 (F2B-1): every process that loads the supervision seam mirrors its
// supervised children into the durable process journal, so evidence survives a
// server restart. Idempotent per process.
installProcessEvidenceSink();

export type SupervisedSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export function supervisedSpawnFn(meta: SupervisedProcessMeta, signal?: AbortSignal): SupervisedSpawn {
  return (command, args, options) => {
    signal?.throwIfAborted();
    const child = nodeSpawn(command, args, options);
    superviseChildProcess(meta, child, signal !== undefined ? { signal } : {});
    return child;
  };
}

export interface ProcessSupervisionContext {
  runId: string;
  label: string;
  operationId?: string;
  signal?: AbortSignal;
}

const supervisionStorage = new AsyncLocalStorage<ProcessSupervisionContext>();

/** Run `fn` with every `supervisedExecFile` child it spawns supervised under `ctx`. */
export function runWithProcessSupervision<T>(ctx: ProcessSupervisionContext, fn: () => Promise<T>): Promise<T> {
  return supervisionStorage.run(ctx, fn);
}

export function currentProcessSupervision(): ProcessSupervisionContext | undefined {
  return supervisionStorage.getStore();
}

/** Register an already-spawned child under the ambient supervision context, if any. */
export function superviseWithAmbientContext(child: ChildProcess): void {
  const ctx = supervisionStorage.getStore();
  if (ctx === undefined) return;
  superviseChildProcess(
    {
      runId: ctx.runId,
      label: ctx.label,
      ...(ctx.operationId !== undefined ? { operationId: ctx.operationId } : {})
    },
    child,
    ctx.signal !== undefined ? { signal: ctx.signal } : {}
  );
}

const execFileRaw = promisify(execFile);

/**
 * Drop-in replacement for `promisify(execFile)` that registers the child under
 * the ambient supervision context (no-op without one).
 */
export function supervisedExecFile(
  command: string,
  args: readonly string[],
  options: { cwd?: string; maxBuffer?: number; windowsHide?: boolean } = {}
): Promise<{ stdout: string; stderr: string }> {
  supervisionStorage.getStore()?.signal?.throwIfAborted();
  const promise = execFileRaw(command, args, options);
  const child = (promise as unknown as { child?: ChildProcess }).child;
  if (child !== undefined) {
    superviseWithAmbientContext(child);
  }
  return promise;
}
