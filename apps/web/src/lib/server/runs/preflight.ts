import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  GEMINI_EXECUTOR_ID,
  normalizeExecutorSelection,
  resolveLegacyModelSelection,
  getExecutorDescriptor,
  type ExecutorId,
  type ExecutorSelection
} from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";

const execFileAsync = promisify(execFile);

export type PreflightCheck = "repo_path" | "cli" | "auth" | "repo_clean" | "branch";

/**
 * Raised when a pre-execution check fails. The message is actionable (mirrors
 * the D3 "never fail silently" rule) so the UI can tell the user exactly what to
 * fix instead of surfacing an opaque mid-run Gemini crash.
 */
export class PreflightError extends Error {
  readonly check: PreflightCheck;

  constructor(check: PreflightCheck, message: string) {
    super(message);
    this.name = "PreflightError";
    this.check = check;
  }
}

export interface PreflightInput {
  repoRoot: string;
  baseBranch: string;
  /** Legacy binary override; defaults to the selected executor descriptor. */
  binaryPath?: string;
  legacyModel?: string;
  graph?: TaskGraph;
  defaultExecutionSelection?: ExecutorSelection;
  defaultRepairSelection?: ExecutorSelection;
}

/** Injectable checks so the pipeline can be unit-tested without spawning. */
export interface PreflightDeps {
  checkCli?: (binaryPath: string) => Promise<boolean>;
  hasCredentials?: () => boolean;
  gitPorcelain?: (repoRoot: string) => Promise<string>;
  branchExists?: (repoRoot: string, branch: string) => Promise<boolean>;
}

/**
 * Blocking preflight run before the real execution engine. The first
 * failing check short-circuits with a PreflightError; the runner persists that
 * message on the run so it projects in the UI like any other execution failure.
 */
export async function runPreflight(input: PreflightInput, deps: PreflightDeps = {}): Promise<void> {
  // 1. A configured workspace repo path is mandatory for real execution.
  if (input.repoRoot.trim().length === 0) {
    throw new PreflightError(
      "repo_path",
      "This workspace has no repository configured. Select a workspace with a local git repo before running."
    );
  }

  // 2-3. Every selected CLI must be installed and authenticated. Auth stays a
  // cheap local/session check; quota probing would spend a model call.
  for (const executorId of collectExecutorIds(input)) {
    const descriptor = getExecutorDescriptor(executorId);
    if (!descriptor.enabled) {
      throw new PreflightError("cli", `Executor "${executorId}" is disabled in this build.`);
    }
    const binaryPath =
      input.binaryPath ??
      process.env[descriptor.binaryEnvVar] ??
      descriptor.defaultBinary;
    const cliOk = await (deps.checkCli ?? defaultCheckCli)(binaryPath);
    if (!cliOk) {
      throw new PreflightError(
        "cli",
        `${descriptor.label} not found. Install it or set ${descriptor.binaryEnvVar} to the binary path.`
      );
    }

    const authed = (deps.hasCredentials ?? (() => defaultHasCredentials(executorId)))();
    if (!authed) {
      throw new PreflightError("auth", authMessageFor(executorId));
    }
  }

  // 4. The repo must be clean so the orchestrator's git diff is the sole source
  // of truth (D5) — stray uncommitted changes would pollute every leaf result.
  const porcelain = await (deps.gitPorcelain ?? defaultGitPorcelain)(input.repoRoot);
  if (porcelain.trim().length > 0) {
    throw new PreflightError(
      "repo_clean",
      `El repositorio en ${input.repoRoot} tiene cambios sin commitear. Commiteá o stasheá antes de ejecutar.`
    );
  }

  // 5. The base branch must resolve.
  const exists = await (deps.branchExists ?? defaultBranchExists)(input.repoRoot, input.baseBranch);
  if (!exists) {
    throw new PreflightError(
      "branch",
      `La rama base "${input.baseBranch}" no existe en ${input.repoRoot}.`
    );
  }
}

async function defaultCheckCli(binaryPath: string): Promise<boolean> {
  try {
    // shell:true on win32 so the npm `.cmd`/`.ps1` shim resolves on PATH.
    await execFileAsync(binaryPath, ["--version"], {
      timeout: 10_000,
      shell: process.platform === "win32"
    });
    return true;
  } catch {
    return false;
  }
}

function collectExecutorIds(input: PreflightInput): ExecutorId[] {
  const fallback = input.defaultExecutionSelection ?? resolveLegacyModelSelection(input.legacyModel);
  const selected = new Set<ExecutorId>([
    fallback.executorId,
    (input.defaultRepairSelection ?? fallback).executorId
  ]);
  for (const node of Object.values(input.graph?.nodes ?? {})) {
    const metadata = node.metadata as { executorSelection?: unknown; executorOverride?: unknown } | undefined;
    const selection =
      normalizeExecutorSelection(metadata?.executorSelection) ??
      normalizeExecutorSelection(metadata?.executorOverride);
    if (selection !== undefined) {
      selected.add(selection.executorId);
    }
  }
  return Array.from(selected);
}

function defaultHasCredentials(executorId: ExecutorId): boolean {
  if (executorId !== GEMINI_EXECUTOR_ID) {
    return Boolean(process.env.ANTHROPIC_API_KEY) || existsSync(join(homedir(), ".claude.json"));
  }
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

function authMessageFor(executorId: ExecutorId): string {
  if (executorId === GEMINI_EXECUTOR_ID) {
    return "Gemini CLI has no credentials. Run `gemini` once to authenticate, or set GEMINI_API_KEY.";
  }
  return "Claude Code CLI has no credentials. Run `claude` once to authenticate, or set ANTHROPIC_API_KEY.";
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
