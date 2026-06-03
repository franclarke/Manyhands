import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Workspace } from "@/lib/api-types";
import { GEMINI_EXECUTOR_ID } from "@/lib/models";

const execFileAsync = promisify(execFile);

export type ProviderReadinessStatus = "ready" | "warning" | "error";
export type ProviderReadinessCheckStatus = "pass" | "warning" | "fail";

export interface ProviderReadinessCheck {
  id: "cli" | "auth" | "repo_path" | "repo_clean" | "branch" | "quota";
  status: ProviderReadinessCheckStatus;
  label: string;
  message: string;
}

export interface ProviderReadiness {
  executorId: typeof GEMINI_EXECUTOR_ID;
  label: string;
  status: ProviderReadinessStatus;
  binaryPath: string;
  version?: string;
  quota: "unknown";
  checks: ProviderReadinessCheck[];
}

export interface GeminiReadinessDeps {
  checkCli?: (binaryPath: string) => Promise<{ ok: boolean; version?: string }>;
  hasCredentials?: () => boolean;
  gitPorcelain?: (repoRoot: string) => Promise<string>;
  branchExists?: (repoRoot: string, branch: string) => Promise<boolean>;
}

export async function inspectGeminiReadiness(
  workspace: Workspace | null,
  deps: GeminiReadinessDeps = {}
): Promise<ProviderReadiness> {
  const binaryPath = process.env.MANYHANDS_GEMINI_BIN ?? "gemini";
  const checks: ProviderReadinessCheck[] = [];

  const cli = await (deps.checkCli ?? defaultCheckCli)(binaryPath);
  checks.push({
    id: "cli",
    status: cli.ok ? "pass" : "fail",
    label: "Gemini CLI",
    message: cli.ok
      ? `Detected${cli.version !== undefined ? `: ${cli.version}` : "."}`
      : "Gemini CLI not found. Install it or set MANYHANDS_GEMINI_BIN."
  });

  const authed = (deps.hasCredentials ?? defaultHasCredentials)();
  checks.push({
    id: "auth",
    status: authed ? "pass" : "fail",
    label: "Authentication",
    message: authed
      ? "Credentials found."
      : "Gemini CLI has no credentials. Run gemini once to authenticate, or set GEMINI_API_KEY."
  });

  const repoPath = workspace?.repoPath;
  if (repoPath === undefined || repoPath.trim().length === 0) {
    checks.push({
      id: "repo_path",
      status: "warning",
      label: "Repository",
      message: "This workspace has no local git repo configured."
    });
  } else {
    checks.push({
      id: "repo_path",
      status: "pass",
      label: "Repository",
      message: repoPath
    });

    const porcelain = await safeGitPorcelain(repoPath, deps.gitPorcelain ?? defaultGitPorcelain);
    checks.push({
      id: "repo_clean",
      status: porcelain.ok && porcelain.output.trim().length === 0 ? "pass" : "warning",
      label: "Repo clean",
      message: porcelain.ok
        ? porcelain.output.trim().length === 0
          ? "No uncommitted changes detected."
          : "Repository has uncommitted changes; execution preflight will block."
        : porcelain.message
    });

    const branch = workspace?.defaultBranch ?? "main";
    const exists = await safeBranchExists(repoPath, branch, deps.branchExists ?? defaultBranchExists);
    checks.push({
      id: "branch",
      status: exists.ok && exists.exists ? "pass" : "warning",
      label: "Base branch",
      message: exists.ok
        ? exists.exists
          ? `Branch "${branch}" resolves.`
          : `Branch "${branch}" does not resolve.`
        : exists.message
    });
  }

  checks.push({
    id: "quota",
    status: "warning",
    label: "Quota",
    message: "Unknown without spending a live Gemini request."
  });

  const status = deriveStatus(checks);
  const readiness: ProviderReadiness = {
    executorId: GEMINI_EXECUTOR_ID,
    label: "Gemini CLI",
    status,
    binaryPath,
    quota: "unknown",
    checks
  };
  if (cli.version !== undefined) readiness.version = cli.version;
  return readiness;
}

function deriveStatus(checks: readonly ProviderReadinessCheck[]): ProviderReadinessStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "error";
  }
  if (checks.some((check) => check.id !== "quota" && check.status === "warning")) {
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

function defaultHasCredentials(): boolean {
  if (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_USE_GCA
  ) {
    return true;
  }
  const geminiHome = join(homedir(), ".gemini");
  return (
    existsSync(join(geminiHome, "oauth_creds.json")) ||
    existsSync(join(geminiHome, "google_accounts.json"))
  );
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
