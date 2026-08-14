import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { simpleGit, type SimpleGit } from "simple-git";

const execFileAsync = promisify(execFile);

/**
 * Outcome of a cherry-pick attempt. `ok: false` carries the conflicting files
 * so the IntegrationAgent can hand them to the agent as a semantic repair task.
 */
export interface CherryPickOutcome {
  ok: boolean;
  /** Production classification; optional so narrow test doubles remain source-compatible. */
  kind?: "applied" | "conflict" | "empty" | "error";
  conflictFiles: string[];
  output: string;
}

export interface GitShowOptions {
  signal?: AbortSignal;
  /** Maximum stdout bytes accepted from Git before the subprocess is terminated. */
  maxBytes?: number;
}

export interface GitTreeEntry {
  mode: string;
  objectType: "blob" | "commit" | "tree" | "tag";
  oid: string;
  path: string;
}

/**
 * Thin git abstraction the execution pipeline depends on. Implemented by
 * SimpleGitRunner (real) and a FakeGitRunner in tests, so worktree/result/
 * integration logic can be exercised without touching disk or a real repo.
 *
 * The configured AgentExecutor handles the agent; git plumbing runs directly.
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
  /** Creates or moves one explicit ref after the caller has verified its object identity. */
  updateRef(params: { cwd: string; ref: string; target: string; expectedOldOid?: string }): Promise<void>;
  treeEntry(params: { cwd: string; tree: string; path: string }): Promise<GitTreeEntry | undefined>;
  objectType(params: { cwd: string; oid: string }): Promise<GitTreeEntry["objectType"]>;
  readTree(params: { cwd: string; tree: string; indexFile?: string }): Promise<void>;
  updateIndexEntry(params: { cwd: string; mode: string; oid: string; path: string; indexFile?: string }): Promise<void>;
  removeIndexEntry(params: { cwd: string; path: string; indexFile?: string }): Promise<void>;
  writeTree(params: { cwd: string; indexFile?: string }): Promise<string>;
  commitTree(params: { cwd: string; tree: string; parent: string; message: string }): Promise<string>;
  resetHard(params: { cwd: string; ref: string }): Promise<void>;
  /** Raw NUL-delimited diff-tree records for exact artifact construction. */
  diffTreeRaw(params: { cwd: string; from: string; to: string }): Promise<Buffer>;
  /** True only when `ancestor` is reachable from `descendant` in the real commit graph. */
  isAncestor(params: { cwd: string; ancestor: string; descendant?: string }): Promise<boolean>;
  /** Durable evidence of an interrupted cherry-pick, if one is active. */
  cherryPickHead(cwd: string): Promise<string | undefined>;
  /** Paths with unresolved index entries. */
  unmergedFiles(cwd: string): Promise<string[]>;
  /** Full worktree/index dirtiness for conservative crash recovery. */
  statusPorcelain(cwd: string): Promise<string[]>;
  /** Reset only a ManyHands-managed worktree after an invalid repair attempt. */
  restoreManagedWorktree(cwd: string, ref: string): Promise<void>;

  addAll(cwd: string): Promise<void>;
  /** `git add -A` minus exclude pathspecs — artifact dirs never enter the index. */
  addAllExcluding(cwd: string, excludeGlobs: readonly string[]): Promise<void>;
  commit(params: { cwd: string; message: string }): Promise<string>;
  /** Full commit message used to validate crash-recovery provenance. */
  commitMessage(cwd: string, commitSha: string): Promise<string>;

  diffCached(cwd: string): Promise<string>;
  diffCachedNameOnly(cwd: string): Promise<string[]>;
  /** Staged paths git reports as additions -- the only evidence of a new file. */
  diffCachedAddedFiles(cwd: string): Promise<string[]>;
  diffCachedNumstat(cwd: string): Promise<number>;

  diffRange(params: { cwd: string; from: string; to: string }): Promise<string>;
  diffRangeNameOnly(params: { cwd: string; from: string; to: string }): Promise<string[]>;
  diffRangeAddedFiles(params: { cwd: string; from: string; to: string }): Promise<string[]>;
  diffRangeNumstat(params: { cwd: string; from: string; to: string }): Promise<number>;

  cherryPick(params: { cwd: string; commitSha: string; mainline?: 1 }): Promise<CherryPickOutcome>;
  cherryPickAbort(cwd: string): Promise<void>;

  /**
   * Materialize a composite handoff commit whose first-parent diff is the
   * complete integrated tree while retaining the physical integration lineage
   * as its second parent. Parents can then cherry-pick it with mainline 1
   * without dropping earlier child commits.
   */
  createIntegrationHandoff(params: {
    cwd: string;
    baseCommit: string;
    message: string;
    /** Physical parent-lineage commits, oldest to newest. */
    appliedCommitShas: readonly string[];
  }): Promise<string>;

  /**
   * Contents of `path` at `ref` (`git show <ref>:<path>`), or null when the file
   * does not exist at that ref. Lets the recorder inspect a worktree's baseline
   * file without staging — e.g. to tell a no-op leaf (baseline already satisfies
   * the contract) from one that left an unimplemented stub behind.
   */
  showFile(
    params: { cwd: string; ref: string; path: string },
    options?: GitShowOptions
  ): Promise<string | null>;
}

/** GitRunner backed by simple-git. Each operation runs against the given cwd. */
export class SimpleGitRunner implements GitRunner {
  private client(cwd: string): SimpleGit {
    return simpleGit({
      baseDir: cwd,
      config: gitPolicyConfig(cwd),
      unsafe: { allowUnsafeHooksPath: true, allowUnsafeCredentialHelper: true, allowUnsafeDiffExternal: true, allowUnsafeProtocolOverride: true }
    });
  }

  private async plumbing(cwd: string, args: readonly string[], indexFile?: string): Promise<string> {
    const { stdout } = await execFileAsync("git", safeGitArgs(cwd, args), {
      cwd,
      windowsHide: true,
      ...(indexFile === undefined ? {} : { env: { ...process.env, GIT_INDEX_FILE: indexFile } })
    });
    return stdout;
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

  async updateRef(params: { cwd: string; ref: string; target: string; expectedOldOid?: string }): Promise<void> {
    await this.client(params.cwd).raw([
      "update-ref",
      params.ref,
      params.target,
      ...(params.expectedOldOid === undefined ? [] : [params.expectedOldOid])
    ]);
  }

  async treeEntry(params: { cwd: string; tree: string; path: string }): Promise<GitTreeEntry | undefined> {
    const output = await this.client(params.cwd).raw(["ls-tree", params.tree, "--", params.path]);
    const line = output.trim();
    if (line.length === 0) return undefined;
    const match = /^(\d{6})\s+(blob|commit|tree|tag)\s+([0-9a-f]+)\t(.+)$/u.exec(line);
    if (match === null) throw new Error(`Could not parse Git tree entry for ${params.path}.`);
    return { mode: match[1]!, objectType: match[2]! as GitTreeEntry["objectType"], oid: match[3]!, path: match[4]! };
  }

  async objectType(params: { cwd: string; oid: string }): Promise<GitTreeEntry["objectType"]> {
    const output = await this.client(params.cwd).raw(["cat-file", "-t", params.oid]);
    const value = output.trim();
    if (value !== "blob" && value !== "commit" && value !== "tree" && value !== "tag") {
      throw new Error(`Unsupported Git object type ${value} for ${params.oid}.`);
    }
    return value;
  }

  async readTree(params: { cwd: string; tree: string; indexFile?: string }): Promise<void> {
    await this.plumbing(params.cwd, ["read-tree", params.tree], params.indexFile);
  }

  async updateIndexEntry(params: { cwd: string; mode: string; oid: string; path: string; indexFile?: string }): Promise<void> {
    await this.plumbing(params.cwd, ["update-index", "--add", "--cacheinfo", `${params.mode},${params.oid},${params.path}`], params.indexFile);
  }

  async removeIndexEntry(params: { cwd: string; path: string; indexFile?: string }): Promise<void> {
    await this.plumbing(params.cwd, ["update-index", "--force-remove", "--", params.path], params.indexFile);
  }

  async writeTree(params: { cwd: string; indexFile?: string }): Promise<string> {
    return (await this.plumbing(params.cwd, ["write-tree"], params.indexFile)).trim();
  }

  async commitTree(params: { cwd: string; tree: string; parent: string; message: string }): Promise<string> {
    const { stdout } = await execFileAsync(
      "git",
      safeGitArgs(params.cwd, [
        "-c", "user.name=ManyHands",
        "-c", "user.email=manyhands@local",
        "commit-tree", params.tree, "-p", params.parent, "-m", params.message
      ]),
      { cwd: params.cwd, windowsHide: true }
    );
    return stdout.trim();
  }

  async resetHard(params: { cwd: string; ref: string }): Promise<void> {
    await this.client(params.cwd).raw(["reset", "--hard", params.ref]);
  }

  async diffTreeRaw(params: { cwd: string; from: string; to: string }): Promise<Buffer> {
    const { stdout } = await execFileAsync(
      "git",
      safeGitArgs(params.cwd, ["diff-tree", "-r", "--no-commit-id", "--raw", "-z", params.from, params.to]),
      { cwd: params.cwd, windowsHide: true, encoding: "buffer" }
    );
    return Buffer.from(stdout);
  }

  async isAncestor(params: { cwd: string; ancestor: string; descendant?: string }): Promise<boolean> {
    try {
      // Do not use simple-git.raw() here. `git merge-base --is-ancestor`
      // intentionally exits 1 with an empty stderr for the ordinary "no"
      // result, and simple-git treats that combination as a resolved command.
      // Reading the native exit code is the only unambiguous contract.
      await execFileAsync(
        "git",
        safeGitArgs(params.cwd, [
          "merge-base",
          "--is-ancestor",
          params.ancestor,
          params.descendant ?? "HEAD"
        ]),
        { cwd: params.cwd, windowsHide: true }
      );
      return true;
    } catch (error) {
      if (gitExitCode(error) === 1) return false;
      throw error;
    }
  }

  async cherryPickHead(cwd: string): Promise<string | undefined> {
    try {
      return (await this.revParse(cwd, "CHERRY_PICK_HEAD")).trim();
    } catch {
      return undefined;
    }
  }

  async unmergedFiles(cwd: string): Promise<string[]> {
    return splitLines(await this.client(cwd).diff(["--no-ext-diff", "--name-only", "--diff-filter=U"]));
  }

  async statusPorcelain(cwd: string): Promise<string[]> {
    return splitLines(await this.client(cwd).raw(["status", "--porcelain=v1", "--untracked-files=all"]));
  }

  async restoreManagedWorktree(cwd: string, ref: string): Promise<void> {
    const git = this.client(cwd);
    await git.raw(["reset", "--hard", ref]);
    await git.raw(["clean", "-fd"]);
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
    const [configuredName, configuredEmail] = await Promise.all([
      git.getConfig("user.name"),
      git.getConfig("user.email")
    ]);
    const commitGit = configuredName.value?.trim() && configuredEmail.value?.trim()
      ? git
      : simpleGit({
          baseDir: params.cwd,
          config: [
            ...gitPolicyConfig(params.cwd),
            "user.name=ManyHands",
            "user.email=manyhands@local"
          ],
          unsafe: { allowUnsafeHooksPath: true, allowUnsafeCredentialHelper: true, allowUnsafeDiffExternal: true, allowUnsafeProtocolOverride: true }
        });
    await commitGit.commit(params.message);
    const sha = await commitGit.revparse(["HEAD"]);
    return sha.trim();
  }

  async commitMessage(cwd: string, commitSha: string): Promise<string> {
    return this.client(cwd).raw(["show", "-s", "--format=%B", commitSha]);
  }

  async diffCached(cwd: string): Promise<string> {
    return this.client(cwd).diff(["--no-ext-diff", "--cached"]);
  }

  async diffCachedNameOnly(cwd: string): Promise<string[]> {
    return splitLines(await this.client(cwd).diff(["--no-ext-diff", "--cached", "--name-only"]));
  }

  async diffCachedAddedFiles(cwd: string): Promise<string[]> {
    return splitLines(await this.client(cwd).diff(["--no-ext-diff", "--cached", "--diff-filter=A", "--name-only"]));
  }

  async diffCachedNumstat(cwd: string): Promise<number> {
    return sumNumstat(await this.client(cwd).diff(["--no-ext-diff", "--cached", "--numstat"]));
  }

  async diffRange(params: { cwd: string; from: string; to: string }): Promise<string> {
    return this.client(params.cwd).diff(["--no-ext-diff", `${params.from}..${params.to}`]);
  }

  async diffRangeNameOnly(params: { cwd: string; from: string; to: string }): Promise<string[]> {
    const out = await this.client(params.cwd).diff([
      "--no-ext-diff",
      `${params.from}..${params.to}`,
      "--name-only"
    ]);
    return splitLines(out);
  }

  async diffRangeAddedFiles(params: { cwd: string; from: string; to: string }): Promise<string[]> {
    return splitLines(await this.client(params.cwd).diff([
      "--no-ext-diff",
      `${params.from}..${params.to}`,
      "--diff-filter=A",
      "--name-only"
    ]));
  }

  async diffRangeNumstat(params: { cwd: string; from: string; to: string }): Promise<number> {
    return sumNumstat(
      await this.client(params.cwd).diff(["--no-ext-diff", `${params.from}..${params.to}`, "--numstat"])
    );
  }

  async showFile(
    params: { cwd: string; ref: string; path: string },
    options?: GitShowOptions
  ): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        safeGitArgs(params.cwd, ["show", `${params.ref}:${params.path}`]),
        {
          cwd: params.cwd,
          windowsHide: true,
          encoding: "buffer",
          ...(options?.signal !== undefined ? { signal: options.signal } : {}),
          ...(options?.maxBytes !== undefined ? { maxBuffer: options.maxBytes } : {})
        }
      );
      return stdout.toString("utf8");
    } catch (error) {
      if (isMissingGitObjectOrPath(error)) return null;
      throw error;
    }
  }

  async cherryPick(params: { cwd: string; commitSha: string; mainline?: 1 }): Promise<CherryPickOutcome> {
    const git = this.client(params.cwd);
    try {
      const output = await git.raw([
        "cherry-pick",
        "-x",
        ...(params.mainline !== undefined ? ["-m", String(params.mainline)] : []),
        params.commitSha
      ]);
      return { ok: true, kind: "applied", conflictFiles: [], output };
    } catch (error) {
      const [conflictFiles, cherryPickHead] = await Promise.all([
        this.unmergedFiles(params.cwd),
        this.cherryPickHead(params.cwd)
      ]);
      const output = error instanceof Error ? error.message : String(error);
      const kind = conflictFiles.length > 0
        ? "conflict"
        : cherryPickHead !== undefined
          ? "empty"
          : "error";
      return { ok: false, kind, conflictFiles, output };
    }
  }

  async cherryPickAbort(cwd: string): Promise<void> {
    await this.client(cwd).raw(["cherry-pick", "--abort"]);
  }

  async createIntegrationHandoff(params: {
    cwd: string;
    baseCommit: string;
    message: string;
    appliedCommitShas: readonly string[];
  }): Promise<string> {
    const git = this.client(params.cwd);
    const lineageHead = (await git.revparse(["HEAD"])).trim();
    if (params.appliedCommitShas.length === 0) {
      if (lineageHead !== params.baseCommit) {
        throw new Error(
          `Integration has no applied children, but HEAD drifted from ${params.baseCommit} to ${lineageHead}.`
        );
      }
      return lineageHead;
    }

    // A crash may happen after the atomic handoff ref update and before the
    // journal transition. Adopt that exact handoff only if its shape and its
    // retained second-parent lineage are both fully explained.
    const existingSecondParent = await git.revparse([`${lineageHead}^2`]).then(
      (value) => value.trim(),
      () => undefined
    );
    if (existingSecondParent !== undefined) {
      const [existingFirstParent, existingTree, secondTree] = await Promise.all([
        git.revparse([`${lineageHead}^1`]).then((value) => value.trim()),
        git.revparse([`${lineageHead}^{tree}`]).then((value) => value.trim()),
        git.revparse([`${existingSecondParent}^{tree}`]).then((value) => value.trim())
      ]);
      if (
        existingFirstParent === params.baseCommit &&
        existingTree === secondTree
      ) {
        await assertExactFirstParentLineage(
          git,
          params.baseCommit,
          existingSecondParent,
          params.appliedCommitShas
        );
        return lineageHead;
      }
      throw new Error(`Existing merge HEAD ${lineageHead} is not a valid ManyHands integration handoff.`);
    }

    await assertExactFirstParentLineage(
      git,
      params.baseCommit,
      lineageHead,
      params.appliedCommitShas
    );
    if (!await this.isAncestor({
      cwd: params.cwd,
      ancestor: params.baseCommit,
      descendant: lineageHead
    })) {
      throw new Error(
        `Cannot create integration handoff: base ${params.baseCommit} is not an ancestor of ${lineageHead}.`
      );
    }

    const tree = (await git.revparse([`${lineageHead}^{tree}`])).trim();
    const handoff = (
      await git.raw([
        "commit-tree",
        tree,
        "-p",
        params.baseCommit,
        "-p",
        lineageHead,
        "-m",
        params.message
      ])
    ).trim();

    const [firstParent, secondParent, handoffTree] = await Promise.all([
      git.revparse([`${handoff}^1`]).then((value) => value.trim()),
      git.revparse([`${handoff}^2`]).then((value) => value.trim()),
      git.revparse([`${handoff}^{tree}`]).then((value) => value.trim())
    ]);
    if (
      firstParent !== params.baseCommit ||
      secondParent !== lineageHead ||
      handoffTree !== tree
    ) {
      throw new Error(
        `Integration handoff ${handoff} has invalid parents or tree ` +
        `(first=${firstParent}, second=${secondParent}, tree=${handoffTree}).`
      );
    }

    // The handoff has the exact same tree as lineageHead, so moving the current
    // worktree ref is an atomic metadata update; index and files remain valid.
    await git.raw(["update-ref", "HEAD", handoff, lineageHead]);
    return handoff;
  }

}

/**
 * Trust only the repository explicitly selected for this git subprocess.
 * This keeps cross-Windows-user workspaces usable without mutating the user's
 * global git config or weakening ownership checks for unrelated repositories.
 */
export type GitInvocationRole = "artifact" | "delivery_target";

export function safeGitArgs(
  cwd: string,
  args: readonly string[],
  role: GitInvocationRole = "artifact"
): string[] {
  const policy = role === "artifact" ? gitPolicyConfig(cwd) : deliveryTargetGitPolicy(cwd);
  return policy.flatMap((entry) => ["-c", entry]).concat(args);
}

/**
 * Deterministic configuration for all Git subprocesses that inspect or build
 * ManyHands artifacts.  Artifact plumbing always addresses Git objects by OID,
 * so it must not inherit user diff drivers, credentials, line-ending conversion
 * or hooks from the selected repository.
 */
export function gitPolicyConfig(cwd: string): string[] {
  return [
    `safe.directory=${gitPath(resolve(cwd))}`,
    "core.hooksPath=/dev/null",
    "credential.helper=",
    "core.autocrlf=false",
    "core.eol=lf",
    "core.attributesFile=/dev/null",
    "diff.trustExitCode=false",
    "protocol.file.allow=never",
    "protocol.ext.allow=never"
  ];
}

/**
 * Delivery operates on the user's checked-out target, so Git must evaluate its
 * native line-ending and attribute configuration when deciding whether that
 * tree is clean.  We still scope trust and suppress repository hooks.
 */
export function deliveryTargetGitPolicy(cwd: string): string[] {
  return [
    `safe.directory=${gitPath(resolve(cwd))}`,
    "core.hooksPath=/dev/null"
  ];
}

function gitPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function gitExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : undefined;
}

function isMissingGitObjectOrPath(error: unknown): boolean {
  if (gitExitCode(error) !== 128 || typeof error !== "object" || error === null || !("stderr" in error)) {
    return false;
  }
  const stderr = Buffer.isBuffer(error.stderr)
    ? error.stderr.toString("utf8")
    : String(error.stderr);
  return [
    /fatal: path .* does not exist in /u,
    /fatal: invalid object name /u,
    /fatal: bad object /u,
    /fatal: bad revision /u,
    /fatal: Not a valid object name /u,
    /fatal: ambiguous argument .*unknown revision or path not in the working tree/u
  ].some((pattern) => pattern.test(stderr));
}

async function assertExactFirstParentLineage(
  git: SimpleGit,
  baseCommit: string,
  lineageHead: string,
  expected: readonly string[]
): Promise<void> {
  const actual = splitLines(
    await git.raw(["rev-list", "--reverse", "--first-parent", `${baseCommit}..${lineageHead}`])
  );
  if (actual.length !== expected.length || actual.some((sha, index) => sha !== expected[index])) {
    throw new Error(
      `Integration lineage ${baseCommit}..${lineageHead} is not fully explained by applied children ` +
      `(expected ${expected.join(", ") || "none"}; observed ${actual.join(", ") || "none"}).`
    );
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
