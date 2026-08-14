/** Factual, provider-measured guarantees. A worktree alone is never a sandbox. */
export interface SandboxCapabilities {
  readonly filesystem: "worktree_only" | "declared_mounts" | "host_visible";
  readonly process: "isolated_tree" | "supervised_only";
  readonly network: "none" | "provider_only" | "allowlist" | "host";
  readonly hostIdentity: "ephemeral" | "brokered" | "inherited";
  readonly enforcement: "os" | "executor_native" | "advisory";
}

export type SandboxProfile = "strong" | "workspace" | "unsafe_local";

export interface DeclaredCredential {
  readonly provider: "codex" | "claude";
  /** Explicit operator/configuration source. This path is never passed to the executor. */
  readonly sourcePath: string;
}

export interface SandboxRequest {
  readonly attemptId: string;
  /** Identifies the supervised worker that owns one or more sandbox attempts. */
  readonly credentialScopeId?: string;
  readonly workspacePath: string;
  readonly profile: SandboxProfile;
  readonly credentials: readonly DeclaredCredential[];
  readonly additionalDirectories?: readonly string[];
}

export interface SandboxReceipt {
  readonly attemptId: string;
  readonly profile: SandboxProfile;
  readonly capabilities: SandboxCapabilities;
  readonly environmentDigest: string;
  readonly createdAt: string;
}

export interface SandboxSession {
  readonly capabilities: SandboxCapabilities;
  readonly environment: Readonly<Record<string, string>>;
  readonly receipt: SandboxReceipt;
  dispose(): Promise<void>;
}

export interface SandboxProvider {
  capabilities(): SandboxCapabilities;
  create(input: SandboxRequest): Promise<SandboxSession>;
}

/** A typed, actionable fail-closed result suitable for a run decision. */
export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(`SANDBOX_UNAVAILABLE: ${message}`);
    this.name = "SandboxUnavailableError";
  }
}

export function satisfiesSandboxProfile(
  capabilities: SandboxCapabilities,
  profile: SandboxProfile
): boolean {
  if (profile === "unsafe_local") return true;
  if (profile === "workspace") {
    return capabilities.filesystem !== "host_visible"
      && capabilities.network !== "host"
      && capabilities.hostIdentity !== "inherited"
      && capabilities.enforcement !== "advisory";
  }
  return capabilities.filesystem === "declared_mounts"
    && capabilities.process === "isolated_tree"
    && capabilities.network !== "host"
    && capabilities.hostIdentity !== "inherited"
    && capabilities.enforcement === "os";
}
