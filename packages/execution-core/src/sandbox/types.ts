/**
 * Factual, provider-measured guarantees. A worktree alone is never a sandbox.
 *
 * Read and write are separate axes because the executors ManyHands drives treat
 * them separately: Codex `workspace-write` confines creation and modification
 * to the workspace while leaving the whole host readable. Collapsing both into
 * one field forced a choice between understating the write boundary and
 * overstating the read boundary, and Stage 8 chose the overstatement.
 */
export interface SandboxCapabilities {
  /** Where the attempt may create, modify or delete files. */
  readonly filesystemWrite: "workspace_only" | "declared_mounts" | "host_visible";
  /** What the attempt may read. */
  readonly filesystemRead: "workspace_only" | "declared_mounts" | "host_visible";
  readonly process: "isolated_tree" | "supervised_only";
  /**
   * `provider_only` means agent-issued commands cannot reach the network but the
   * executor itself still calls its model API. That egress is never `none`.
   */
  readonly network: "none" | "provider_only" | "allowlist" | "host";
  readonly hostIdentity: "ephemeral" | "brokered" | "inherited";
  /**
   * Whether host-installed skills, plugins, hooks and MCP servers remain visible
   * to the executor. A brokered `HOME` does not make them `declared_only`:
   * a CLI may resolve them through the platform rather than the environment.
   */
  readonly tooling: "declared_only" | "host_visible";
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
    // A workspace boundary is a write boundary. It deliberately says nothing
    // about reads, so a provider that leaves the host readable still qualifies
    // — as long as it reports that fact.
    return capabilities.filesystemWrite !== "host_visible"
      && capabilities.network !== "host"
      && capabilities.hostIdentity !== "inherited"
      && capabilities.enforcement !== "advisory";
  }
  return capabilities.filesystemWrite !== "host_visible"
    && capabilities.filesystemRead !== "host_visible"
    && capabilities.process === "isolated_tree"
    && capabilities.network !== "host"
    && capabilities.hostIdentity !== "inherited"
    && capabilities.tooling === "declared_only"
    && capabilities.enforcement === "os";
}

/**
 * The exact sandbox surface recorded inside an attempt's executor profile
 * revision. It carries the provider's measured capabilities rather than a
 * parallel, hand-maintained claim: an executor profile revision is attributable
 * evidence, and a second copy of the boundary is a second chance to be wrong.
 */
export interface SandboxSurface {
  readonly profile: SandboxProfile;
  readonly capabilities: SandboxCapabilities;
  /** Repository, project and user setting sources are pinned off in argv. */
  readonly settingsSources: "fixed";
  readonly additionalDirectories: readonly string[];
  readonly windowsSandbox?: "elevated" | "unelevated";
}

export function describeSandboxSurface(input: {
  readonly profile: SandboxProfile;
  readonly capabilities: SandboxCapabilities;
  readonly additionalDirectories?: readonly string[];
  readonly windowsSandbox?: "elevated" | "unelevated";
}): SandboxSurface {
  return {
    profile: input.profile,
    capabilities: { ...input.capabilities },
    settingsSources: "fixed",
    additionalDirectories: [...(input.additionalDirectories ?? [])],
    ...(input.windowsSandbox === undefined ? {} : { windowsSandbox: input.windowsSandbox })
  };
}
