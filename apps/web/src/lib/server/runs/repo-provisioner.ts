import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_EXCLUDE_LINES,
  EXCLUDE_BLOCK_MARKER,
  safeGitArgs
} from "@manyhands/execution-core";

import { resolveManyhandsPath, resolveRepoRoot } from "../repo-root";
import { inspectLocalGitRepo } from "../workspaces/repo-validation";
import { rmWithRetry } from "./fs-retry";
import { supervisedExecFile } from "./process-supervision";
import type { ProvisionedRepoRecord } from "./schema";

// B-005: provisioning clones/reads the source repo with git subprocesses; the
// ambient supervision context registers them under the run for verified kill.
const execFileAsync = supervisedExecFile;

/**
 * Where a run executes. `localPath` is the product path for real workspaces.
 * `fixture` remains as a legacy/testing path for executable fixture directories.
 *
 * Crosses a boundary (persisted on the RunRecord, may arrive from the API),
 * so it is a Zod schema, not a bare interface.
 */
export const RepoSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixture"),
    fixtureId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("localPath"),
    path: z.string().min(1)
  })
]);

export type RepoSpec = z.infer<typeof RepoSpecSchema>;

/**
 * An executable git repo prepared for one run. In-process value (never
 * persisted as-is — the RunRecord stores a serializable subset), so a plain
 * interface, no Zod.
 */
export interface ProvisionedRepo {
  /** Absolute path RunExecutor roots its worktrees at. */
  repoRoot: string;
  /** Canonical checkout selected by the user. Never mutated before delivery. */
  sourceRepoRoot: string;
  /** Branch/ref captured from the source checkout when the run was provisioned. */
  sourceBranch: string;
  /** Immutable source HEAD captured before any run-owned mutation. */
  sourceBaseCommit: string;
  /** Branch the base commit lives on. */
  baseBranch: string;
  /** Current base for leaf execution (moves once when grounding commits). */
  baseCommit: string;
  /** Explicit alias for the current run-owned execution base. */
  executionBaseCommit: string;
  /** Best-effort teardown of the per-run working directory. */
  cleanup: () => Promise<void>;
}

export interface ProvisionInput {
  spec: RepoSpec;
  runId: string;
}

export interface RepoProvisioner {
  provision(input: ProvisionInput): Promise<ProvisionedRepo>;
}

/** Durable recovery result for a run-owned repository root. */
export interface RecreatedProvisionedRepo {
  recreated: boolean;
  provisioned: ProvisionedRepo;
}

/**
 * Raised when a repo cannot be prepared for execution (missing fixture, copy
 * failure, git bootstrap failure). Carries the offending spec and the
 * underlying cause for trace/inspection. Co-located with the provisioner to
 * avoid an import cycle with the generic run errors module.
 */
export class RepoProvisionError extends Error {
  readonly spec: RepoSpec;

  constructor(spec: RepoSpec, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepoProvisionError";
    this.spec = spec;
  }
}

const BASE_BRANCH = "main";

/** Directories never copied into the per-run repo (rebuilt or irrelevant). */
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".git"]);

interface FixtureProvisionerOptions {
  /** Legacy option name. Root holding executable fixtures. Default: `<repoRoot>/benchmarks`. */
  benchmarksRoot?: string;
  /** Root for per-run working copies. Default: `<repoRoot>/.manyhands/work`. */
  workRoot?: string;
}

/**
 * Provisions a run repo by copying a versioned executable fixture into an
 * isolated per-run working directory and bootstrapping a single-commit git
 * history. No network, no `npm install` (Etapa 2A): the result is an
 * executable tree with a real base commit, nothing more.
 */
export function createFixtureRepoProvisioner(
  options: FixtureProvisionerOptions = {}
): RepoProvisioner {
  const fixtureRoot = options.benchmarksRoot ?? path.join(resolveRepoRoot(), "benchmarks");
  const workRoot = options.workRoot ?? resolveManyhandsPath("work");

  return {
    async provision({ spec, runId }): Promise<ProvisionedRepo> {
      if (spec.kind !== "fixture") {
        throw new RepoProvisionError(spec, "Fixture provisioner only supports fixture repo specs.");
      }
      const source = path.join(fixtureRoot, spec.fixtureId);
      await assertFixtureExists(spec, source);

      const repoRoot = path.join(workRoot, runId, "repo");
      const cleanup = async (): Promise<void> => {
        await rmWithRetry(path.join(workRoot, runId));
      };

      try {
        // Fresh per-run copy: clear any stale directory first.
        await rmWithRetry(repoRoot);
        await mkdir(repoRoot, { recursive: true });
        await cp(source, repoRoot, {
          recursive: true,
          filter: (src) => !EXCLUDED_DIRS.has(path.basename(src))
        });
        const baseCommit = await bootstrapGitRepo(repoRoot, spec.fixtureId);
        return {
          repoRoot,
          sourceRepoRoot: repoRoot,
          sourceBranch: BASE_BRANCH,
          sourceBaseCommit: baseCommit,
          baseBranch: BASE_BRANCH,
          baseCommit,
          executionBaseCommit: baseCommit,
          cleanup
        };
      } catch (error) {
        if (error instanceof RepoProvisionError) throw error;
        await cleanup().catch(() => undefined);
        throw new RepoProvisionError(
          spec,
          `Failed to provision fixture "${spec.fixtureId}": ${describeCause(error)}`,
          { cause: error }
        );
      }
    }
  };
}

/** Provisions either a fixture copy or an existing local git repo. */
export function createDefaultRepoProvisioner(
  options: FixtureProvisionerOptions = {}
): RepoProvisioner {
  const fixture = createFixtureRepoProvisioner(options);
  return {
    async provision(input): Promise<ProvisionedRepo> {
      if (input.spec.kind === "fixture") {
        return fixture.provision(input);
      }
      const info = await inspectLocalGitRepo(input.spec.path);
      if (info.head === undefined) {
        throw new RepoProvisionError(
          input.spec,
          `Local git repo has no commits yet: ${info.repoRoot}. Create an initial commit before running ManyHands.`
        );
      }
      return provisionLocalRepoCopy({
        sourceRepoRoot: info.repoRoot,
        sourceBranch: info.branch,
        sourceBaseCommit: info.head,
        runId: input.runId,
        workRoot: options.workRoot ?? resolveManyhandsPath("work"),
        spec: input.spec
      });
    }
  };
}

/**
 * Rebuild a removed run-owned repository from the immutable source/base
 * descriptor. This never invokes grounding or an executor: when the exact
 * execution base is gone, recovery must stop rather than invent new evidence.
 */
export async function recreateProvisionedRepo(input: {
  runId: string;
  record: ProvisionedRepoRecord;
}): Promise<RecreatedProvisionedRepo> {
  const record = input.record;
  const sourceRepoRoot = record.sourceRepoRoot ?? record.repoRoot;
  const sourceBranch = record.sourceBranch ?? record.baseBranch;
  const sourceBaseCommit = record.sourceBaseCommit ?? record.baseCommit;
  const executionBaseCommit = record.executionBaseCommit ?? record.baseCommit;
  const runRoot = path.dirname(record.repoRoot);
  const cleanup = async (): Promise<void> => rmWithRetry(runRoot);
  const provisioned = (): ProvisionedRepo => ({
    repoRoot: record.repoRoot,
    sourceRepoRoot,
    sourceBranch,
    sourceBaseCommit,
    baseBranch: record.baseBranch,
    baseCommit: record.baseCommit,
    executionBaseCommit,
    cleanup
  });

  try {
    await access(record.repoRoot);
    return { recreated: false, provisioned: provisioned() };
  } catch {
    // Only an absent root is reconstructed. Replacing an existing path is a
    // cleanup responsibility and would risk deleting external work.
  }

  try {
    await execFileAsync(
      "git",
      safeGitArgs(sourceRepoRoot, ["cat-file", "-e", `${executionBaseCommit}^{commit}`]),
      { cwd: sourceRepoRoot }
    );
  } catch (error) {
    throw new RepoProvisionError(
      { kind: "localPath", path: sourceRepoRoot },
      `Cannot recreate run ${input.runId}: execution base ${executionBaseCommit} is unavailable in the captured source repository.`,
      { cause: error }
    );
  }

  try {
    await mkdir(runRoot, { recursive: true });
    await execFileAsync(
      "git",
      safeGitArgs(sourceRepoRoot, ["clone", "--no-checkout", "--local", sourceRepoRoot, record.repoRoot]),
      { cwd: runRoot }
    );
    await execFileAsync("git", safeGitArgs(record.repoRoot, ["checkout", "--detach", executionBaseCommit]), { cwd: record.repoRoot });
    await execFileAsync("git", safeGitArgs(record.repoRoot, ["config", "user.email", "manyhands@local"]), { cwd: record.repoRoot });
    await execFileAsync("git", safeGitArgs(record.repoRoot, ["config", "user.name", "ManyHands Orchestrator"]), { cwd: record.repoRoot });
    await execFileAsync("git", safeGitArgs(record.repoRoot, ["config", "commit.gpgsign", "false"]), { cwd: record.repoRoot });
    await ensureGitInfoExclude(record.repoRoot);
    return { recreated: true, provisioned: provisioned() };
  } catch (error) {
    await rmWithRetry(record.repoRoot).catch(() => undefined);
    throw new RepoProvisionError(
      { kind: "localPath", path: sourceRepoRoot },
      `Failed to recreate isolated repository for run ${input.runId}: ${describeCause(error)}`,
      { cause: error }
    );
  }
}

async function provisionLocalRepoCopy(input: {
  sourceRepoRoot: string;
  sourceBranch: string;
  sourceBaseCommit: string;
  runId: string;
  workRoot: string;
  spec: Extract<RepoSpec, { kind: "localPath" }>;
}): Promise<ProvisionedRepo> {
  const runRoot = path.join(input.workRoot, input.runId);
  const repoRoot = path.join(runRoot, "repo");
  const cleanup = async (): Promise<void> => rmWithRetry(runRoot);

  try {
    await cleanup();
    await mkdir(runRoot, { recursive: true });
    // A separate repository keeps refs, index and git metadata out of the
    // checkout selected by the user. Leaf isolation still uses git worktrees,
    // now rooted in this run-owned repository.
    await execFileAsync(
      "git",
      safeGitArgs(input.sourceRepoRoot, ["clone", "--no-checkout", "--local", input.sourceRepoRoot, repoRoot]),
      { cwd: runRoot }
    );
    await execFileAsync("git", safeGitArgs(repoRoot, ["checkout", "--detach", input.sourceBaseCommit]), { cwd: repoRoot });
    await execFileAsync("git", safeGitArgs(repoRoot, ["config", "user.email", "manyhands@local"]), { cwd: repoRoot });
    await execFileAsync("git", safeGitArgs(repoRoot, ["config", "user.name", "ManyHands Orchestrator"]), { cwd: repoRoot });
    await execFileAsync("git", safeGitArgs(repoRoot, ["config", "commit.gpgsign", "false"]), { cwd: repoRoot });
    await ensureGitInfoExclude(repoRoot);

    return {
      repoRoot,
      sourceRepoRoot: input.sourceRepoRoot,
      sourceBranch: input.sourceBranch,
      sourceBaseCommit: input.sourceBaseCommit,
      baseBranch: input.sourceBranch,
      baseCommit: input.sourceBaseCommit,
      executionBaseCommit: input.sourceBaseCommit,
      cleanup
    };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw new RepoProvisionError(
      input.spec,
      `Failed to create an isolated run repository from ${input.sourceRepoRoot}: ${describeCause(error)}`,
      { cause: error }
    );
  }
}

/**
 * Append the default artifact excludes to the repo's `.git/info/exclude`
 * (resolved via `--git-common-dir`, so it also covers every worktree of the
 * run AND the case where the user's repo is itself a worktree). Idempotent —
 * the block is marker-delimited and only missing lines are added. Never
 * touches the working tree or the user's .gitignore. Best-effort: a failure
 * here must not block provisioning (the recorder's staging filter is the
 * second line of defense).
 */
export async function ensureGitInfoExclude(repoRoot: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync("git", safeGitArgs(repoRoot, ["rev-parse", "--git-common-dir"]), { cwd: repoRoot });
    const commonDir = path.resolve(repoRoot, stdout.trim());
    const excludePath = path.join(commonDir, "info", "exclude");

    let current = "";
    try {
      current = await readFile(excludePath, "utf8");
    } catch {
      // No exclude file yet — we'll create it (info/ exists in standard repos).
    }

    const existing = new Set(current.split(/\r?\n/).map((line) => line.trim()));
    const missing = DEFAULT_EXCLUDE_LINES.filter((line) => !existing.has(line));
    if (missing.length === 0) return;

    const block = [EXCLUDE_BLOCK_MARKER, ...missing].join("\n");
    const next = current.length === 0 || current.endsWith("\n") ? `${current}${block}\n` : `${current}\n${block}\n`;
    await mkdir(path.dirname(excludePath), { recursive: true });
    await writeFile(excludePath, next, "utf8");
  } catch {
    // Best-effort by design.
  }
}

async function assertFixtureExists(spec: Extract<RepoSpec, { kind: "fixture" }>, source: string): Promise<void> {
  try {
    await access(source);
  } catch (error) {
    throw new RepoProvisionError(
      spec,
      `Fixture "${spec.fixtureId}" not found at ${source}. ` +
        "Provide a fixtureId that names a directory under the configured fixture root.",
      { cause: error }
    );
  }
}

/**
 * `git init -b main` + a single deterministic commit. Sets identity and
 * disables gpg signing at repo level so the commit succeeds on machines
 * without a global git identity (Windows CI included). Returns the commit SHA.
 */
async function bootstrapGitRepo(repoRoot: string, fixtureId: string): Promise<string> {
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", safeGitArgs(repoRoot, args), { cwd: repoRoot });
    return stdout.trim();
  };

  await git("init", "-b", BASE_BRANCH);
  await git("config", "user.email", "manyhands@local");
  await git("config", "user.name", "ManyHands Provisioner");
  await git("config", "commit.gpgsign", "false");
  await ensureGitInfoExclude(repoRoot);
  await git("add", "-A");
  await git("commit", "-m", `manyhands: provision ${fixtureId}`);
  return git("rev-parse", "HEAD");
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
