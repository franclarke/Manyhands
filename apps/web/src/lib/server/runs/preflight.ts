import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  normalizeExecutorSelection,
  resolveLegacyModelSelection,
  getExecutorDescriptor,
  cliPathRequiresShell,
  resolveCliBinaryPath,
  type ExecutorId,
  type ExecutorSelection
} from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";
import { credentialMessageFor, defaultCredentialStatus } from "@/lib/server/providers/credentials";

const execFileAsync = promisify(execFile);

export type PreflightCheck = "repo_path" | "cli" | "auth" | "repo_clean" | "branch" | "disk_space" | "repo_busy";

/** Non-blocking finding: the run proceeds, but the runner logs it for the operator. */
export interface PreflightWarning {
  check: "gitignore" | "dependencies";
  message: string;
}

export interface PreflightReport {
  warnings: PreflightWarning[];
}

/** Below this many free bytes the run is doomed to die mid-flight (builds, worktrees, .next). */
const MIN_FREE_DISK_BYTES = 1024 * 1024 * 1024; // 1 GiB

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
  selectionLocked?: boolean;
  defaultExecutionSelection?: ExecutorSelection;
  defaultRepairSelection?: ExecutorSelection;
  groundingSelection?: ExecutorSelection;
}

/** Injectable checks so the pipeline can be unit-tested without spawning. */
export interface PreflightDeps {
  checkCli?: (binaryPath: string) => Promise<boolean>;
  hasCredentials?: () => boolean;
  gitPorcelain?: (repoRoot: string) => Promise<string>;
  branchExists?: (repoRoot: string, branch: string) => Promise<boolean>;
  /** Free bytes on the volume holding the repo; undefined ⇒ probe unavailable, check skipped. */
  freeDiskBytes?: (repoRoot: string) => Promise<number | undefined>;
}

/**
 * Blocking preflight run before the real execution engine. The first
 * failing check short-circuits with a PreflightError; the runner persists that
 * message on the run so it projects in the UI like any other execution failure.
 * Returns non-blocking warnings (e.g. missing .gitignore) for the caller to log.
 */
export async function runPreflight(input: PreflightInput, deps: PreflightDeps = {}): Promise<PreflightReport> {
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

    // Validity, not mere presence (F-001b): an expired on-disk OAuth token must
    // fail preflight with an actionable error here, instead of letting the run
    // start and 401 on every leaf. Injected boolean seam preserved for tests.
    const authStatus = deps.hasCredentials
      ? (deps.hasCredentials() ? ({ ok: true } as const) : ({ ok: false, reason: "absent" } as const))
      : defaultCredentialStatus(executorId);
    if (!authStatus.ok) {
      throw new PreflightError("auth", credentialMessageFor(executorId, authStatus.reason));
    }
  }

  // 4. The repo must be clean so the orchestrator's git diff is the sole source
  // of truth (D5) — stray uncommitted changes would pollute every leaf result.
  // ManyHands-owned artifacts (.manyhands/: worktrees, run.lock) don't count as
  // user dirt — a restart would otherwise always fail its own preflight.
  const porcelain = await (deps.gitPorcelain ?? defaultGitPorcelain)(input.repoRoot);
  const userDirt = porcelain
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.slice(3).startsWith(".manyhands/"));
  if (userDirt.length > 0) {
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

  // 6. Enough disk to survive worktrees + builds. A run that dies on ENOSPC
  // mid-integration is far costlier than failing here with a clear remedy.
  const freeBytes = await (deps.freeDiskBytes ?? defaultFreeDiskBytes)(input.repoRoot);
  if (freeBytes !== undefined && freeBytes < MIN_FREE_DISK_BYTES) {
    const freeMb = Math.round(freeBytes / (1024 * 1024));
    throw new PreflightError(
      "disk_space",
      `Quedan ${freeMb} MB libres en el volumen del repo (mínimo: 1024 MB). ` +
        "Liberá espacio (ej.: borrar apps/web/.next o limpiar .manyhands/worktrees viejos) antes de ejecutar."
    );
  }

  // 7. Advisory only: without a .gitignore, agents that install dependencies
  // rely entirely on ManyHands' exclude defaults (info/exclude + staging
  // filter). Worth telling the operator, never worth blocking the run.
  const warnings: PreflightWarning[] = [];
  if (!existsSync(join(input.repoRoot, ".gitignore"))) {
    warnings.push({
      check: "gitignore",
      message:
        `El repo en ${input.repoRoot} no tiene .gitignore. ManyHands excluye artefactos comunes ` +
        "(node_modules, dist, .next…) vía .git/info/exclude, pero conviene agregar un .gitignore propio."
    });
  }

  // 8. Advisory: worktrees link the base repo's node_modules so validation
  // commands (`npm test` → jest) resolve their binaries. If the base repo
  // declares dependencies (package.json + lockfile) but never installed them,
  // there is nothing to link and every validation command dies with exit 127.
  if (dependenciesDeclaredButNotInstalled(input.repoRoot)) {
    warnings.push({
      check: "dependencies",
      message:
        `El repo en ${input.repoRoot} declara dependencias (package.json + lockfile) pero no tiene ` +
        "node_modules instalado. Los comandos de validación de integración fallarán (exit 127 / binario " +
        "no encontrado). Corré la instalación (npm/pnpm/yarn install) en el repo base antes de ejecutar."
    });
  }
  return { warnings };
}

/** Lockfiles that signal a JS dependency install is expected before running. */
const JS_LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json"];

function dependenciesDeclaredButNotInstalled(repoRoot: string): boolean {
  if (!existsSync(join(repoRoot, "package.json"))) return false;
  const hasLockfile = JS_LOCKFILES.some((lockfile) => existsSync(join(repoRoot, lockfile)));
  if (!hasLockfile) return false;
  return !existsSync(join(repoRoot, "node_modules"));
}

async function defaultFreeDiskBytes(repoRoot: string): Promise<number | undefined> {
  try {
    const { statfs } = await import("node:fs/promises");
    const stats = await statfs(repoRoot);
    return stats.bavail * stats.bsize;
  } catch {
    return undefined; // Probe unavailable (old Node, exotic FS): skip the check.
  }
}

async function defaultCheckCli(binaryPath: string): Promise<boolean> {
  try {
    const resolvedBinaryPath = resolveCliBinaryPath(binaryPath);
    // Resolve once so preflight and execution agree on the concrete CLI binary.
    // A shell is only needed for Windows batch shims.
    await execFileAsync(resolvedBinaryPath, ["--version"], {
      timeout: 10_000,
      shell: cliPathRequiresShell(resolvedBinaryPath)
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
    (input.defaultRepairSelection ?? fallback).executorId,
    ...(input.groundingSelection !== undefined ? [input.groundingSelection.executorId] : [])
  ]);
  for (const node of Object.values(input.graph?.nodes ?? {})) {
    const metadata = node.metadata as { executorSelection?: unknown; executorOverride?: unknown } | undefined;
    const selection =
      normalizeExecutorSelection(metadata?.executorSelection) ??
      normalizeExecutorSelection(metadata?.executorOverride);
    if (selection !== undefined) {
      if (input.selectionLocked === true && !sameSelection(selection, fallback)) {
        throw new PreflightError(
          "cli",
          `Node "${node.id}" requests executor/model "${selection.executorId}/${selection.model}", ` +
            `but this run is fixed to "${fallback.executorId}/${fallback.model}".`
        );
      }
      selected.add(selection.executorId);
    }
  }
  return Array.from(selected);
}

function sameSelection(left: ExecutorSelection, right: ExecutorSelection): boolean {
  return left.executorId === right.executorId && left.model === right.model;
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
