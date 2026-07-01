import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

import { EXECUTOR_DESCRIPTORS, type ExecutorId } from "../executor/registry";

export interface ProbeExecutorAvailabilityDeps {
  /** Injectable binary resolver for tests. Defaults to PATH lookup / fs access. */
  commandExists?: (binary: string) => Promise<boolean>;
  env?: Record<string, string | undefined>;
}

/**
 * Which enabled executors actually have a working CLI on this machine. The
 * router only routes across this set, so a machine with only `gemini`
 * installed degrades gracefully instead of failing leaves with ENOENT.
 * Probe failures count as unavailable — never as errors.
 */
export async function probeExecutorAvailability(
  deps: ProbeExecutorAvailabilityDeps = {}
): Promise<Set<ExecutorId>> {
  const commandExists = deps.commandExists ?? defaultCommandExists;
  const env = deps.env ?? process.env;

  const available = new Set<ExecutorId>();
  await Promise.all(
    EXECUTOR_DESCRIPTORS.filter((descriptor) => descriptor.enabled).map(async (descriptor) => {
      const binary = env[descriptor.binaryEnvVar] ?? descriptor.defaultBinary;
      try {
        if (await commandExists(binary)) {
          available.add(descriptor.id);
        }
      } catch {
        // Unavailable, not fatal.
      }
    })
  );
  return available;
}

/** Explicit paths are checked on disk; bare names via the platform's PATH lookup. */
async function defaultCommandExists(binary: string): Promise<boolean> {
  if (binary.includes("/") || binary.includes("\\")) {
    try {
      await access(binary);
      return true;
    } catch {
      return false;
    }
  }
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  return new Promise<boolean>((resolve) => {
    // `where.exe` is a real Windows executable; avoid shell:true + args, which
    // triggers DEP0190 on newer Node versions and is unnecessary for PATH lookup.
    const child = spawn(lookup, [binary], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
