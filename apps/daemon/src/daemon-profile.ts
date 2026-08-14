import path from "node:path";

import type { ProductiveDaemonProfile } from "./productive-daemon.js";
import {
  createCurrentSandboxedLiveProfile,
  createCurrentTransitionalUnsafeProfile
} from "./current-lifecycle-adapters.js";

export type DaemonProfileName = "deterministic_fake" | "transitional_unsafe" | "sandboxed_live";

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
  if (requested !== "deterministic_fake" && requested !== "transitional_unsafe" && requested !== "sandboxed_live") {
    throw new Error(
      `Unsupported daemon profile ${requested}. Expected deterministic_fake, transitional_unsafe, or sandboxed_live.`
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
  if (requested === "sandboxed_live") {
    const codexCredentialPath = optionalAbsoluteEnv(env, "MANYHANDS_CODEX_AUTH_PATH");
    const claudeCredentialPath = optionalAbsoluteEnv(env, "MANYHANDS_CLAUDE_CREDENTIAL_PATH");
    const codexWindowsSandbox = optionalWindowsSandbox(env);
    if (codexCredentialPath === undefined && claudeCredentialPath === undefined) {
      throw new Error("sandboxed_live requires a declared Codex or Claude credential source; refusing host identity inheritance.");
    }
    return {
      name: requested,
      profile: createCurrentSandboxedLiveProfile({
        stateRoot: absolute(options.stateRoot, "daemon state root"),
        nodeExecutable: absolute(options.nodeExecutable, "node executable"),
        workerScriptPath: optionalAbsoluteEnv(
          env,
          "MANYHANDS_TRANSITIONAL_WORKER_SCRIPT"
        ) ?? path.join(absolute(options.daemonDirectory, "daemon directory"), "transitional-unsafe-worker.js"),
        cwd: absolute(options.cwd, "daemon cwd"),
        ...(codexCredentialPath === undefined
          ? {}
          : { codexCredentialPath }),
        ...(codexWindowsSandbox === undefined
          ? {}
          : { codexWindowsSandbox }),
        ...(claudeCredentialPath === undefined
          ? {}
          : { claudeCredentialPath })
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

function optionalWindowsSandbox(env: NodeJS.ProcessEnv): "elevated" | "unelevated" | undefined {
  const value = env.MANYHANDS_STAGE8_WINDOWS_SANDBOX;
  if (value === undefined || value.trim().length === 0) return undefined;
  if (value === "elevated" || value === "unelevated") return value;
  throw new Error("Unsupported Stage 8 Windows sandbox. Expected elevated or unelevated.");
}

function absolute(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return path.resolve(value);
}
