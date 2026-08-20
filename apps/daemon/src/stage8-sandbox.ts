import path from "node:path";

import {
  CredentialBroker,
  WorkspaceSandboxProvider,
  type DeclaredCredential,
  type SandboxProfile
} from "@manyhands/execution-core";

/**
 * The one live executor Stage 8 qualified. The Claude adapter remains in the
 * tree as unqualified code: it has no measured capability record of its own and
 * Claude Code carries no native OS sandbox, so lending it the Codex-measured
 * record would be exactly the silent degradation GLeaf forbids. Qualifying a
 * second live executor needs its own gate, not a wider allowlist here.
 */
export const QUALIFIED_LIVE_EXECUTOR_ID = "codex-cli";

export interface Stage8Sandbox {
  readonly provider: WorkspaceSandboxProvider;
  readonly profile: SandboxProfile;
  readonly credentials: readonly DeclaredCredential[];
  readonly credentialScopeId: string;
  readonly windowsSandbox: "elevated" | "unelevated";
}

export function stage8SandboxFor(input: {
  stateRoot: string;
  executionExecutorId: string;
  env?: NodeJS.ProcessEnv;
}): Stage8Sandbox | undefined {
  const env = input.env ?? process.env;
  if (env.MANYHANDS_STAGE8_SANDBOX === undefined) return undefined;
  if (env.MANYHANDS_STAGE8_SANDBOX !== "workspace") {
    throw new Error("Unsupported Stage 8 sandbox profile; refusing unattended execution.");
  }
  if (input.executionExecutorId !== QUALIFIED_LIVE_EXECUTOR_ID) {
    throw new Error(
      `Stage 8 has no qualified live sandbox for ${input.executionExecutorId}; only ${QUALIFIED_LIVE_EXECUTOR_ID} is qualified.`
    );
  }
  return {
    provider: new WorkspaceSandboxProvider({
      rootDirectory: path.join(input.stateRoot, "sandboxes"),
      credentialBroker: new CredentialBroker({
        rootDirectory: path.join(input.stateRoot, "credential-broker")
      })
    }),
    profile: "workspace",
    credentials: [{
      provider: "codex",
      sourcePath: requiredAbsoluteEnvironment(env, "MANYHANDS_CODEX_AUTH_PATH")
    }],
    credentialScopeId: requiredEnvironment(env, "MANYHANDS_STAGE8_SANDBOX_SCOPE"),
    windowsSandbox: stage8WindowsSandbox(env)
  };
}

export function stage8WindowsSandbox(env: NodeJS.ProcessEnv = process.env): "elevated" | "unelevated" {
  const value = env.MANYHANDS_STAGE8_WINDOWS_SANDBOX ?? "unelevated";
  if (value === "elevated" || value === "unelevated") return value;
  throw new Error("Unsupported Stage 8 Windows sandbox; refusing unattended execution.");
}

function requiredAbsoluteEnvironment(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0 || !path.isAbsolute(value)) {
    throw new Error(`Stage 8 requires declared absolute credential source ${name}.`);
  }
  return path.resolve(value);
}

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0 || value.includes("\0")) {
    throw new Error(`Stage 8 requires ${name}.`);
  }
  return value;
}
