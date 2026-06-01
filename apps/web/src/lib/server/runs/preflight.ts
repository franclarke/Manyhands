import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

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
  /** Gemini CLI binary; defaults to $MANYHANDS_GEMINI_BIN or `gemini`. */
  binaryPath?: string;
}

/** Injectable checks so the pipeline can be unit-tested without spawning. */
export interface PreflightDeps {
  checkCli?: (binaryPath: string) => Promise<boolean>;
  hasCredentials?: () => boolean;
  gitPorcelain?: (repoRoot: string) => Promise<string>;
  branchExists?: (repoRoot: string, branch: string) => Promise<boolean>;
}

/**
 * Blocking preflight run before the real Gemini execution engine. The first
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

  // 2. The Gemini CLI must be installed and resolvable.
  const binaryPath = input.binaryPath ?? process.env.MANYHANDS_GEMINI_BIN ?? "gemini";
  const cliOk = await (deps.checkCli ?? defaultCheckCli)(binaryPath);
  if (!cliOk) {
    throw new PreflightError(
      "cli",
      "Gemini CLI not found. Install it (npm i -g @google/gemini-cli) or set MANYHANDS_GEMINI_BIN to the binary path."
    );
  }

  // 3. Lightweight auth/quota check: credentials must be present (env key or a
  // cached OAuth session). A real quota probe would cost a call; presence is the
  // cheap signal that catches the common "never logged in" failure.
  const authed = (deps.hasCredentials ?? defaultHasCredentials)();
  if (!authed) {
    throw new PreflightError(
      "auth",
      "Gemini CLI has no credentials. Run `gemini` once to authenticate, or set GEMINI_API_KEY."
    );
  }

  // 4. The repo must be clean so the orchestrator's git diff is the sole source
  // of truth (D5) — stray uncommitted changes would pollute every leaf result.
  const porcelain = await (deps.gitPorcelain ?? defaultGitPorcelain)(input.repoRoot);
  if (porcelain.trim().length > 0) {
    throw new PreflightError(
      "repo_clean",
      `The repository at ${input.repoRoot} has uncommitted changes. Commit or stash them before running.`
    );
  }

  // 5. The base branch must resolve.
  const exists = await (deps.branchExists ?? defaultBranchExists)(input.repoRoot, input.baseBranch);
  if (!exists) {
    throw new PreflightError(
      "branch",
      `Base branch "${input.baseBranch}" does not exist in ${input.repoRoot}.`
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
