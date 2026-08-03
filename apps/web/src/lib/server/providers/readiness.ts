import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  CLAUDE_CODE_EXECUTOR_ID,
  EXECUTOR_DESCRIPTORS,
  type ExecutorDescriptor,
  type ExecutorId
} from "@manyhands/shared";
import {
  resolveCliProcessInvocation,
  resolveCliBinaryPath,
  safeGitArgs
} from "@manyhands/execution-core";
import type { Workspace } from "@/lib/api-types";
import {
  detectWorkspaceCommands,
  hasDetectedCommands,
  type DetectedCommands
} from "./command-detection";
import { credentialMessageFor, defaultCredentialStatus } from "./credentials";

const execFileAsync = promisify(execFile);

export type ProviderReadinessStatus = "ready" | "warning" | "error";
export type ProviderReadinessCheckStatus = "pass" | "warning" | "fail";

export interface ProviderReadinessCheck {
  id: "enabled" | "cli" | "auth" | "repo_path" | "repo_clean" | "branch" | "commands" | "quota";
  status: ProviderReadinessCheckStatus;
  label: string;
  message: string;
}

export interface ProviderReadiness {
  executorId: ExecutorId;
  label: string;
  status: ProviderReadinessStatus;
  binaryPath: string;
  version?: string;
  quota: "unknown";
  checks: ProviderReadinessCheck[];
}

export interface ProviderReadinessDeps {
  checkCli?: (binaryPath: string) => Promise<{ ok: boolean; version?: string }>;
  hasCredentials?: (executorId: ExecutorId) => boolean;
  gitPorcelain?: (repoRoot: string) => Promise<string>;
  branchExists?: (repoRoot: string, branch: string) => Promise<boolean>;
  detectCommands?: (repoPath: string) => Promise<DetectedCommands>;
}

export async function inspectProvidersReadiness(
  workspace: Workspace | null,
  deps: ProviderReadinessDeps = {}
): Promise<ProviderReadiness[]> {
  const workspaceChecks = await inspectWorkspace(workspace, deps);
  return Promise.all(
    EXECUTOR_DESCRIPTORS.map((descriptor: ExecutorDescriptor) => inspectExecutor(descriptor, workspaceChecks, deps))
  );
}

export async function inspectPrimaryProviderReadiness(
  workspace: Workspace | null,
  deps: ProviderReadinessDeps = {}
): Promise<ProviderReadiness> {
  const providers = await inspectProvidersReadiness(workspace, deps);
  return providers.find((provider) => provider.executorId === CLAUDE_CODE_EXECUTOR_ID) ?? providers[0]!;
}

async function inspectExecutor(
  descriptor: ExecutorDescriptor,
  workspaceChecks: ProviderReadinessCheck[],
  deps: ProviderReadinessDeps
): Promise<ProviderReadiness> {
  const binaryPath = process.env[descriptor.binaryEnvVar] ?? descriptor.defaultBinary;
  const checks: ProviderReadinessCheck[] = [];

  if (!descriptor.enabled) {
    checks.push({
      id: "enabled",
      status: "warning",
      label: "Habilitado",
      message: "Registrado para uso futuro; deshabilitado en este build."
    });
    checks.push({
      id: "quota",
      status: "warning",
      label: "Cuota",
      message: "No disponible mientras el executor está deshabilitado."
    });
    return {
      executorId: descriptor.id,
      label: descriptor.label,
      status: "warning",
      binaryPath,
      quota: "unknown",
      checks
    };
  }

  const cli = await (deps.checkCli ?? defaultCheckCli)(binaryPath);
  checks.push({
    id: "cli",
    status: cli.ok ? "pass" : "fail",
    label: descriptor.label,
    message: cli.ok
      ? `Detectado${cli.version !== undefined ? `: ${cli.version}` : "."}`
      : `No se encontró ${descriptor.label}. Instalalo o configurá ${descriptor.binaryEnvVar}.`
  });

  // Validity, not mere presence (F-028): an expired on-disk OAuth token (F-001)
  // must surface as a failed auth check, not a false "ready". The injected
  // boolean seam stays for unit tests; the default reads token expiry.
  const authStatus = deps.hasCredentials
    ? (deps.hasCredentials(descriptor.id) ? ({ ok: true } as const) : ({ ok: false, reason: "absent" } as const))
    : defaultCredentialStatus(descriptor.id);
  checks.push({
    id: "auth",
    status: authStatus.ok ? "pass" : "fail",
    label: "Autenticación",
    message: authStatus.ok ? "Credenciales encontradas." : credentialMessageFor(descriptor.id, authStatus.reason)
  });

  checks.push(...workspaceChecks);
  checks.push({
    id: "quota",
    status: "warning",
    label: "Cuota",
    message: "Desconocida sin gastar una request real al modelo."
  });

  const readiness: ProviderReadiness = {
    executorId: descriptor.id,
    label: descriptor.label,
    status: deriveStatus(checks),
    binaryPath,
    quota: "unknown",
    checks
  };
  if (cli.version !== undefined) readiness.version = cli.version;
  return readiness;
}

async function inspectWorkspace(
  workspace: Workspace | null,
  deps: ProviderReadinessDeps
): Promise<ProviderReadinessCheck[]> {
  const checks: ProviderReadinessCheck[] = [];
  const repoPath = workspace?.repoPath;
  if (repoPath === undefined || repoPath.trim().length === 0) {
    checks.push({
      id: "repo_path",
      status: "warning",
      label: "Repositorio",
      message: "Este workspace no tiene un repo git local configurado."
    });
    return checks;
  }

  checks.push({
    id: "repo_path",
    status: "pass",
    label: "Repositorio",
    message: repoPath
  });

  const porcelain = await safeGitPorcelain(repoPath, deps.gitPorcelain ?? defaultGitPorcelain);
  // Mirror preflight: ManyHands-owned artifacts under `.manyhands/` (worktrees,
  // run.lock) are not user dirt and never block execution, so they must not warn
  // here either — otherwise readiness lies about what preflight will do.
  const userDirty = porcelain.ok && countUserDirt(porcelain.output) > 0;
  checks.push({
    id: "repo_clean",
    status: !porcelain.ok || userDirty ? "warning" : "pass",
    label: "Repo limpio",
    message: porcelain.ok
      ? userDirty
        ? "El repo tiene cambios sin commitear; el preflight de ejecución va a bloquear."
        : "Sin cambios sin commitear."
      : porcelain.message
  });

  const branch = workspace?.defaultBranch ?? "main";
  const exists = await safeBranchExists(repoPath, branch, deps.branchExists ?? defaultBranchExists);
  checks.push({
    id: "branch",
    status: exists.ok && exists.exists ? "pass" : "warning",
    label: "Rama base",
    message: exists.ok
      ? exists.exists
        ? `La rama "${branch}" resuelve.`
        : `La rama "${branch}" no resuelve.`
      : exists.message
  });

  const commands = await (deps.detectCommands ?? detectWorkspaceCommands)(repoPath).catch(() => ({
    packageManager: "unknown" as const
  }));
  const summary = describeDetectedCommands(commands);
  checks.push({
    id: "commands",
    status: hasDetectedCommands(commands) ? "pass" : "warning",
    label: "Comandos",
    message: summary
  });
  return checks;
}

function describeDetectedCommands(commands: DetectedCommands): string {
  const parts: string[] = [];
  if (commands.test !== undefined) parts.push(`test: ${commands.test}`);
  if (commands.build !== undefined) parts.push(`build: ${commands.build}`);
  if (commands.typecheck !== undefined) parts.push(`typecheck: ${commands.typecheck}`);
  if (commands.lint !== undefined) parts.push(`lint: ${commands.lint}`);
  return parts.length > 0
    ? parts.join(" · ")
    : "Sin scripts de test/build en package.json; la validación dependerá de los comandos del contrato.";
}

function deriveStatus(checks: readonly ProviderReadinessCheck[]): ProviderReadinessStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "error";
  }
  // `quota` and `commands` are informational — a missing build script shouldn't
  // mark a provider "not ready"; validation can still rely on contract commands.
  if (checks.some((check) => check.id !== "quota" && check.id !== "commands" && check.status === "warning")) {
    return "warning";
  }
  return "ready";
}

/**
 * Count porcelain lines that represent real user changes, excluding
 * ManyHands-owned artifacts under `.manyhands/` (same rule as preflight.ts).
 */
function countUserDirt(porcelain: string): number {
  return porcelain
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.slice(3).startsWith(".manyhands/")).length;
}

async function defaultCheckCli(binaryPath: string): Promise<{ ok: boolean; version?: string }> {
  try {
    const resolvedBinaryPath = resolveCliBinaryPath(binaryPath);
    const invocation = resolveCliProcessInvocation(resolvedBinaryPath, ["--version"]);
    const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
      timeout: 10_000,
      shell: invocation.shell,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments
    });
    const version = (stdout || stderr).trim();
    return version.length > 0 ? { ok: true, version } : { ok: true };
  } catch {
    return { ok: false };
  }
}

async function defaultGitPorcelain(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", safeGitArgs(repoRoot, ["status", "--porcelain"]), { cwd: repoRoot });
  return stdout;
}

async function defaultBranchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync("git", safeGitArgs(repoRoot, ["rev-parse", "--verify", "--quiet", branch]), { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function safeGitPorcelain(
  repoRoot: string,
  gitPorcelain: (repoRoot: string) => Promise<string>
): Promise<{ ok: true; output: string } | { ok: false; message: string }> {
  try {
    return { ok: true, output: await gitPorcelain(repoRoot) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function safeBranchExists(
  repoRoot: string,
  branch: string,
  branchExists: (repoRoot: string, branch: string) => Promise<boolean>
): Promise<{ ok: true; exists: boolean } | { ok: false; message: string }> {
  try {
    return { ok: true, exists: await branchExists(repoRoot, branch) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
