import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CredentialBroker } from "./credential-broker.js";
import {
  SandboxUnavailableError,
  satisfiesSandboxProfile,
  type SandboxCapabilities,
  type SandboxProvider,
  type SandboxReceipt,
  type SandboxRequest,
  type SandboxSession
} from "./types.js";

/**
 * What the Codex/Claude native workspace mode actually delivers, as observed by
 * the Stage 8 qualifying runs — not what was requested of it. The R0 and R17
 * traces record the attempt reading a host path outside the worktree and the
 * brokered home, and the executor reporting that every host-installed skill was
 * still in its context. Reads and host tooling are therefore unconfined, and the
 * executor's own model API egress means the network is never `none`.
 */
const WORKSPACE_CAPABILITIES: SandboxCapabilities = Object.freeze({
  filesystemWrite: "workspace_only",
  filesystemRead: "host_visible",
  process: "supervised_only",
  network: "provider_only",
  hostIdentity: "brokered",
  tooling: "host_visible",
  enforcement: "executor_native"
});

export interface WorkspaceSandboxProviderOptions {
  readonly rootDirectory: string;
  readonly credentialBroker: CredentialBroker;
  readonly clock?: () => string;
  readonly toolchainEnvironment?: Readonly<Record<string, string | undefined>>;
}

/**
 * A Codex/Claude native workspace boundary. It is intentionally not labelled
 * strong: the provider confines the executor through its documented native
 * workspace mode while process-tree custody remains the daemon supervisor's
 * responsibility.
 */
export class WorkspaceSandboxProvider implements SandboxProvider {
  private readonly rootDirectory: string;
  private readonly clock: () => string;
  private readonly toolchainEnvironment: Readonly<Record<string, string | undefined>>;

  constructor(private readonly options: WorkspaceSandboxProviderOptions) {
    if (!path.isAbsolute(options.rootDirectory)) {
      throw new Error("Workspace sandbox rootDirectory must be absolute.");
    }
    this.rootDirectory = path.resolve(options.rootDirectory);
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.toolchainEnvironment = options.toolchainEnvironment ?? process.env;
  }

  capabilities(): SandboxCapabilities {
    return { ...WORKSPACE_CAPABILITIES };
  }

  async create(input: SandboxRequest): Promise<SandboxSession> {
    if (!satisfiesSandboxProfile(WORKSPACE_CAPABILITIES, input.profile)) {
      throw new SandboxUnavailableError(
        `profile ${input.profile} requires capabilities unavailable from workspace provider.`
      );
    }
    if ((input.additionalDirectories?.length ?? 0) > 0) {
      throw new SandboxUnavailableError("additional directories are not declared for the workspace provider.");
    }
    if (!path.isAbsolute(input.workspacePath)) {
      throw new Error("Sandbox workspacePath must be absolute.");
    }
    await mkdir(path.resolve(input.workspacePath), { recursive: true });
    await mkdir(this.rootDirectory, { recursive: true });
    const brokered = await this.options.credentialBroker.create(
      input.attemptId,
      input.credentials,
      input.credentialScopeId
    );
    let scratchDirectory: string | undefined;
    try {
      await seedCodexWindowsSandboxSetup(input.credentials, brokered.homeDirectory);
      scratchDirectory = path.join(this.rootDirectory, digest(input.attemptId));
      await mkdir(scratchDirectory, { recursive: true });
      const environment = sandboxEnvironment(brokered.homeDirectory, scratchDirectory, this.toolchainEnvironment);
      await Promise.all([
        mkdir(environment.APPDATA!, { recursive: true }),
        mkdir(environment.LOCALAPPDATA!, { recursive: true }),
        mkdir(environment.XDG_CONFIG_HOME!, { recursive: true }),
        mkdir(environment.XDG_DATA_HOME!, { recursive: true }),
        mkdir(environment.XDG_CACHE_HOME!, { recursive: true }),
        mkdir(environment.PSModuleAnalysisCachePath!, { recursive: true })
      ]);
      const receipt: SandboxReceipt = {
        attemptId: input.attemptId,
        profile: input.profile,
        capabilities: this.capabilities(),
        environmentDigest: `sha256:${createHash("sha256").update(JSON.stringify(environment)).digest("hex")}`,
        createdAt: this.clock()
      };
      return {
        capabilities: this.capabilities(),
        environment,
        receipt,
        dispose: async () => {
          await Promise.all([
            brokered.dispose(),
            rm(scratchDirectory!, { recursive: true, force: true })
          ]);
        }
      };
    } catch (error) {
      await Promise.all([
        brokered.dispose(),
        ...(scratchDirectory === undefined ? [] : [rm(scratchDirectory, { recursive: true, force: true })])
      ]);
      throw error;
    }
  }
}

/**
 * Codex's Windows command sandbox treats this non-secret installation receipt
 * as proof that the native sandbox users and policy are already provisioned.
 * A brokered CODEX_HOME must carry that receipt; otherwise Codex attempts setup
 * inside the attempt and can neither prove nor enforce the requested boundary.
 */
async function seedCodexWindowsSandboxSetup(
  credentials: readonly { provider: string; sourcePath: string }[],
  homeDirectory: string
): Promise<void> {
  if (process.platform !== "win32") return;
  const codexCredential = credentials.find((credential) => credential.provider === "codex");
  if (codexCredential === undefined) return;
  const markerPath = path.join(path.dirname(codexCredential.sourcePath), ".sandbox", "setup_marker.json");
  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    throw new SandboxUnavailableError(`Codex native sandbox setup marker is unavailable at ${markerPath}.`);
  }
  if (
    typeof marker !== "object" || marker === null ||
    typeof (marker as { version?: unknown }).version !== "number" ||
    typeof (marker as { offline_username?: unknown }).offline_username !== "string" ||
    typeof (marker as { online_username?: unknown }).online_username !== "string"
  ) {
    throw new SandboxUnavailableError(`Codex native sandbox setup marker is invalid at ${markerPath}.`);
  }
  const target = path.join(homeDirectory, ".codex", ".sandbox", "setup_marker.json");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(marker), "utf8");
}

function sandboxEnvironment(
  homeDirectory: string,
  scratchDirectory: string,
  host: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const inherited = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "SYSTEMDRIVE"];
  const environment = Object.fromEntries(inherited.flatMap((name) => {
    const value = host[name];
    return value === undefined ? [] : [[name, value]];
  })) as Record<string, string>;
  environment.HOME = homeDirectory;
  environment.USERPROFILE = homeDirectory;
  environment.APPDATA = path.join(homeDirectory, "AppData", "Roaming");
  environment.LOCALAPPDATA = path.join(homeDirectory, "AppData", "Local");
  environment.XDG_CONFIG_HOME = path.join(homeDirectory, ".config");
  environment.XDG_DATA_HOME = path.join(homeDirectory, ".local", "share");
  environment.XDG_CACHE_HOME = path.join(homeDirectory, ".cache");
  environment.CODEX_HOME = path.join(homeDirectory, ".codex");
  environment.TEMP = scratchDirectory;
  environment.TMP = scratchDirectory;
  environment.PSModuleAnalysisCachePath = path.join(scratchDirectory, "PowerShell", "ModuleAnalysisCache");
  return environment;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
