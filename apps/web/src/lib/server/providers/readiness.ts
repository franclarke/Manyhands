import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  CLAUDE_CODE_EXECUTOR_ID,
  EXECUTOR_DESCRIPTORS,
  GEMINI_EXECUTOR_ID,
  type ExecutorDescriptor,
  type ExecutorId
} from "@manyhands/execution-core";
import type { Workspace } from "@/lib/api-types";
import {
  detectWorkspaceCommands,
  hasDetectedCommands,
  type DetectedCommands
} from "./command-detection";

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
    EXECUTOR_DESCRIPTORS.map((descriptor) => inspectExecutor(descriptor, workspaceChecks, deps))
  );
}

export async function inspectGeminiReadiness(
  workspace: Workspace | null,
  deps: ProviderReadinessDeps = {}
): Promise<ProviderReadiness> {
  const providers = await inspectProvidersReadiness(workspace, deps);
  return providers.find((provider) => provider.executorId === GEMINI_EXECUTOR_ID) ?? providers[0]!;
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

  const authed = (deps.hasCredentials ?? defaultHasCredentials)(descriptor.id);
  checks.push({
    id: "auth",
    status: authed ? "pass" : "fail",
    label: "Autenticación",
    message: authed ? "Credenciales encontradas." : authMessageFor(descriptor.id)
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
  checks.push({
    id: "repo_clean",
    status: porcelain.ok && porcelain.output.trim().length === 0 ? "pass" : "warning",
    label: "Repo limpio",
    message: porcelain.ok
      ? porcelain.output.trim().length === 0
        ? "Sin cambios sin commitear."
        : "El repo tiene cambios sin commitear; el preflight de ejecución va a bloquear."
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

async function defaultCheckCli(binaryPath: string): Promise<{ ok: boolean; version?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], {
      timeout: 10_000,
      shell: process.platform === "win32"
    });
    const version = (stdout || stderr).trim();
    return version.length > 0 ? { ok: true, version } : { ok: true };
  } catch {
    return { ok: false };
  }
}

function defaultHasCredentials(executorId: ExecutorId): boolean {
  if (executorId === GEMINI_EXECUTOR_ID) {
    return Boolean(
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_USE_GCA ||
      existsSync(join(homedir(), ".gemini", "oauth_creds.json")) ||
      existsSync(join(homedir(), ".gemini", "google_accounts.json"))
    );
  }
  if (executorId === CLAUDE_CODE_EXECUTOR_ID) {
    return Boolean(process.env.ANTHROPIC_API_KEY || existsSync(join(homedir(), ".claude.json")));
  }
  return false;
}

function authMessageFor(executorId: ExecutorId): string {
  if (executorId === GEMINI_EXECUTOR_ID) {
    return "Gemini CLI no tiene credenciales. Corré gemini una vez para autenticarte, o configurá GEMINI_API_KEY.";
  }
  if (executorId === CLAUDE_CODE_EXECUTOR_ID) {
    return "Claude Code CLI no tiene credenciales. Corré claude una vez para autenticarte, o configurá ANTHROPIC_API_KEY.";
  }
  return "Chequeo de autenticación no disponible para este executor deshabilitado.";
}

async function defaultGitPorcelain(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
  return stdout;
}

async function defaultBranchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", branch], { cwd: repoRoot });
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
