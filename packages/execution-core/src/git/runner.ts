import { simpleGit, type SimpleGit } from "simple-git";

/**
 * Outcome of a cherry-pick attempt. `ok: false` carries the conflicting files
 * so the IntegrationAgent can hand them to the agent as a semantic repair task.
 */
export interface CherryPickOutcome {
  ok: boolean;
  conflictFiles: string[];
  output: string;
}

/**
 * Thin git abstraction the execution pipeline depends on. Implemented by
 * SimpleGitRunner (real) and a FakeGitRunner in tests, so worktree/result/
 * integration logic can be exercised without touching disk or a real repo.
 *
 * The agent executor (Gemini CLI) handles the *agent*; git plumbing runs directly.
 */
export interface GitRunner {
  worktreeAdd(params: {
    repoRoot: string;
    worktreePath: string;
    branch: string;
    baseCommit: string;
  }): Promise<void>;
  worktreeRemove(params: { repoRoot: string; worktreePath: string; force?: boolean }): Promise<void>;
  /** Drops stale worktree bookkeeping for paths that no longer exist on disk. */
  worktreePrune(repoRoot: string): Promise<void>;
  branchDelete(params: { repoRoot: string; branch: string; force?: boolean }): Promise<void>;

  head(cwd: string): Promise<string>;
  revParse(cwd: string, ref: string): Promise<string>;

  addAll(cwd: string): Promise<void>;
  /** `git add -A` minus exclude pathspecs — artifact dirs never enter the index. */
  addAllExcluding(cwd: string, excludeGlobs: readonly string[]): Promise<void>;
  commit(params: { cwd: string; message: string }): Promise<string>;

  diffCached(cwd: string): Promise<string>;
  diffCachedNameOnly(cwd: string): Promise<string[]>;
  diffCachedNumstat(cwd: string): Promise<number>;

  diffRange(params: { cwd: string; from: string; to: string }): Promise<string>;
  diffRangeNameOnly(params: { cwd: string; from: string; to: string }): Promise<string[]>;
  diffRangeNumstat(params: { cwd: string; from: string; to: string }): Promise<number>;

  cherryPick(params: { cwd: string; commitSha: string }): Promise<CherryPickOutcome>;
  cherryPickAbort(cwd: string): Promise<void>;
}

/** GitRunner backed by simple-git. Each operation runs against the given cwd. */
export class SimpleGitRunner implements GitRunner {
  private client(cwd: string): SimpleGit {
    return simpleGit({ baseDir: cwd });
  }

  async worktreeAdd(params: {
    repoRoot: string;
    worktreePath: string;
    branch: string;
    baseCommit: string;
  }): Promise<void> {
    await this.client(params.repoRoot).raw([
      "worktree",
      "add",
      params.worktreePath,
      "-b",
      params.branch,
      params.baseCommit
    ]);
  }

  async worktreeRemove(params: {
    repoRoot: string;
    worktreePath: string;
    force?: boolean;
  }): Promise<void> {
    const args = ["worktree", "remove"];
    if (params.force ?? true) {
      args.push("--force");
    }
    args.push(params.worktreePath);
    await this.client(params.repoRoot).raw(args);
  }

  async worktreePrune(repoRoot: string): Promise<void> {
    await this.client(repoRoot).raw(["worktree", "prune"]);
  }

  async branchDelete(params: { repoRoot: string; branch: string; force?: boolean }): Promise<void> {
    await this.client(params.repoRoot).raw([
      "branch",
      params.force ?? true ? "-D" : "-d",
      params.branch
    ]);
  }

  async head(cwd: string): Promise<string> {
    return this.revParse(cwd, "HEAD");
  }

  async revParse(cwd: string, ref: string): Promise<string> {
    const out = await this.client(cwd).revparse([ref]);
    return out.trim();
  }

  async addAll(cwd: string): Promise<void> {
    await this.client(cwd).add(["-A"]);
  }

  /**
   * `git add -A` minus artifact globs, as exclude pathspecs in one command —
   * dependency/build trees never enter the index even when the target repo
   * has no .gitignore (second line of defense after .git/info/exclude).
   */
  async addAllExcluding(cwd: string, excludeGlobs: readonly string[]): Promise<void> {
    if (excludeGlobs.length === 0) {
      await this.addAll(cwd);
      return;
    }
    await this.client(cwd).raw([
      "add",
      "-A",
      "--",
      ".",
      ...excludeGlobs.map((glob) => `:(exclude,glob)${glob}`)
    ]);
  }

  async commit(params: { cwd: string; message: string }): Promise<string> {
    const git = this.client(params.cwd);
    await git.commit(params.message);
    const sha = await git.revparse(["HEAD"]);
    return sha.trim();
  }

  async diffCached(cwd: string): Promise<string> {
    return this.client(cwd).diff(["--cached"]);
  }

  async diffCachedNameOnly(cwd: string): Promise<string[]> {
    return splitLines(await this.client(cwd).diff(["--cached", "--name-only"]));
  }

  async diffCachedNumstat(cwd: string): Promise<number> {
    return sumNumstat(await this.client(cwd).diff(["--cached", "--numstat"]));
  }

  async diffRange(params: { cwd: string; from: string; to: string }): Promise<string> {
    return this.client(params.cwd).diff([`${params.from}..${params.to}`]);
  }

  async diffRangeNameOnly(params: { cwd: string; from: string; to: string }): Promise<string[]> {
    const out = await this.client(params.cwd).diff([
      `${params.from}..${params.to}`,
      "--name-only"
    ]);
    return splitLines(out);
  }

  async diffRangeNumstat(params: { cwd: string; from: string; to: string }): Promise<number> {
    return sumNumstat(
      await this.client(params.cwd).diff([`${params.from}..${params.to}`, "--numstat"])
    );
  }

  async cherryPick(params: { cwd: string; commitSha: string }): Promise<CherryPickOutcome> {
    const git = this.client(params.cwd);
    try {
      const output = await git.raw(["cherry-pick", params.commitSha]);
      return { ok: true, conflictFiles: [], output };
    } catch (error) {
      const conflictFiles = await this.unmergedFiles(params.cwd);
      const output = error instanceof Error ? error.message : String(error);
      return { ok: false, conflictFiles, output };
    }
  }

  async cherryPickAbort(cwd: string): Promise<void> {
    await this.client(cwd).raw(["cherry-pick", "--abort"]);
  }

  private async unmergedFiles(cwd: string): Promise<string[]> {
    return splitLines(await this.client(cwd).diff(["--name-only", "--diff-filter=U"]));
  }
}

function splitLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function sumNumstat(output: string): number {
  let total = 0;
  for (const line of output.split("\n")) {
    const [added, deleted] = line.trim().split(/\s+/u);
    const addedNum = Number.parseInt(added ?? "", 10);
    const deletedNum = Number.parseInt(deleted ?? "", 10);
    if (Number.isFinite(addedNum)) {
      total += addedNum;
    }
    if (Number.isFinite(deletedNum)) {
      total += deletedNum;
    }
  }
  return total;
}
