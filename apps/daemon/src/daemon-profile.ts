import path from "node:path";

import type { ProductiveDaemonProfile } from "./productive-daemon.js";
import { createCurrentTransitionalUnsafeProfile } from "./current-lifecycle-adapters.js";

export type DaemonProfileName = "deterministic_fake" | "transitional_unsafe";

export interface ResolveDaemonProfileOptions {
  readonly stateRoot: string;
  readonly daemonDirectory: string;
  readonly cwd: string;
  readonly nodeExecutable: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Exact, explicit CLI profile selection. No live path is enabled by default. */
export function resolveDaemonProfile(options: ResolveDaemonProfileOptions): {
  name: DaemonProfileName;
  profile: ProductiveDaemonProfile;
} {
  const env = options.env ?? process.env;
  const requested = env.MANYHANDS_DAEMON_PROFILE ?? "deterministic_fake";
  if (requested !== "deterministic_fake" && requested !== "transitional_unsafe") {
    throw new Error(
      `Unsupported daemon profile ${requested}. Expected deterministic_fake or transitional_unsafe.`
    );
  }
  if (requested === "transitional_unsafe") {
    return {
      name: requested,
      profile: createCurrentTransitionalUnsafeProfile({
        stateRoot: absolute(options.stateRoot, "daemon state root"),
        nodeExecutable: absolute(options.nodeExecutable, "node executable"),
        workerScriptPath: optionalAbsoluteEnv(
          env,
          "MANYHANDS_TRANSITIONAL_WORKER_SCRIPT"
        ) ?? path.join(absolute(options.daemonDirectory, "daemon directory"), "transitional-unsafe-worker.js"),
        cwd: absolute(options.cwd, "daemon cwd")
      })
    };
  }
  const pidEvidencePath = optionalAbsoluteEnv(env, "MANYHANDS_FAKE_PID_EVIDENCE");
  return {
    name: requested,
    profile: {
      kind: "deterministic_fake",
      nodeExecutable: absolute(options.nodeExecutable, "node executable"),
      workerScriptPath: optionalAbsoluteEnv(env, "MANYHANDS_FAKE_WORKER_SCRIPT")
        ?? path.join(absolute(options.daemonDirectory, "daemon directory"), "deterministic-fake-worker.js"),
      cwd: absolute(options.cwd, "daemon cwd"),
      ...(pidEvidencePath === undefined ? {} : { pidEvidencePath })
    }
  };
}

function optionalAbsoluteEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) return undefined;
  return absolute(value, name);
}

function absolute(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return path.resolve(value);
}
