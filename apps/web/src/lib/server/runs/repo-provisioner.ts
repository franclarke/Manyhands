import { execFile } from "node:child_process";
import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { resolveManyhandsPath, resolveRepoRoot } from "../repo-root";
import { rmWithRetry } from "./fs-retry";

const execFileAsync = promisify(execFile);

/**
 * Where a run executes. In Etapa 2A only `fixture` is supported: a versioned,
 * executable benchmark directory under `benchmarks/` (e.g. `task-manager-api`).
 * `localPath`/remote clone are deferred — when they arrive this becomes a
 * `z.discriminatedUnion("kind", [...])`.
 *
 * Crosses a boundary (persisted on the RunRecord, may arrive from the API),
 * so it is a Zod schema, not a bare interface.
 */
export const RepoSpecSchema = z.object({
  kind: z.literal("fixture"),
  fixtureId: z.string().min(1)
});

export type RepoSpec = z.infer<typeof RepoSpecSchema>;

/**
 * An executable git repo prepared for one run. In-process value (never
 * persisted as-is — the RunRecord stores a serializable subset), so a plain
 * interface, no Zod.
 */
export interface ProvisionedRepo {
  /** Absolute path RunExecutor roots its worktrees at. */
  repoRoot: string;
  /** Branch the base commit lives on. */
  baseBranch: string;
  /** Real 40-hex SHA of the initial commit. */
  baseCommit: string;
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
  /** Root holding executable fixtures. Default: `<repoRoot>/benchmarks`. */
  benchmarksRoot?: string;
  /** Root for per-run working copies. Default: `<repoRoot>/.manyhands/work`. */
  workRoot?: string;
}

/**
 * Provisions a run repo by copying a versioned benchmark fixture into an
 * isolated per-run working directory and bootstrapping a single-commit git
 * history. No network, no `npm install` (Etapa 2A): the result is an
 * executable tree with a real base commit, nothing more.
 */
export function createFixtureRepoProvisioner(
  options: FixtureProvisionerOptions = {}
): RepoProvisioner {
  const benchmarksRoot = options.benchmarksRoot ?? path.join(resolveRepoRoot(), "benchmarks");
  const workRoot = options.workRoot ?? resolveManyhandsPath("work");

  return {
    async provision({ spec, runId }): Promise<ProvisionedRepo> {
      const source = path.join(benchmarksRoot, spec.fixtureId);
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
        return { repoRoot, baseBranch: BASE_BRANCH, baseCommit, cleanup };
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

async function assertFixtureExists(spec: RepoSpec, source: string): Promise<void> {
  try {
    await access(source);
  } catch (error) {
    throw new RepoProvisionError(
      spec,
      `Fixture "${spec.fixtureId}" not found at ${source}. ` +
        "Provide a fixtureId that names a directory under benchmarks/.",
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
    const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
    return stdout.trim();
  };

  await git("init", "-b", BASE_BRANCH);
  await git("config", "user.email", "manyhands@local");
  await git("config", "user.name", "ManyHands Provisioner");
  await git("config", "commit.gpgsign", "false");
  await git("add", "-A");
  await git("commit", "-m", `manyhands: provision ${fixtureId}`);
  return git("rev-parse", "HEAD");
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
