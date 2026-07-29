import type { CherryPickOutcome, GitRunner } from "@manyhands/execution-core";

export interface FakeGitCall {
  op: string;
  args: Record<string, unknown>;
}

export interface FakeGitRunnerConfig {
  /** cwd -> HEAD sha. Mutable; defaults to "BASE" for unknown cwds. */
  heads?: Record<string, string>;
  /** sha returned by commit(). */
  commitSha?: string;
  /** shas dequeued one per commit() call; useful when duplicate commits are invalid. */
  commitShas?: string[];
  diffCached?: string;
  diffCachedNameOnly?: string[];
  diffCachedAddedFiles?: string[];
  diffCachedNumstat?: number;
  diffRange?: string;
  diffRangeNameOnly?: string[];
  diffRangeAddedFiles?: string[];
  diffRangeNumstat?: number;
  /** Dequeued one per cherryPick() call; defaults to a clean success. */
  cherryPickOutcomes?: CherryPickOutcome[];
  /** Resulting parent-lineage SHAs for successful cherry-picks. */
  cherryPickResultShas?: string[];
  /** Operations that should throw when invoked. */
  failOperations?: Partial<Record<string, Error>>;
  /** refs that should fail revParse(), used to simulate missing commits. */
  missingRefs?: string[];
  /** path -> file contents returned by showFile(); absent paths resolve to null. */
  showFile?: Record<string, string>;
  /** ref -> path -> contents, for comparisons where the same path differs by commit. */
  showFileByRef?: Record<string, Record<string, string>>;
  /** Commits that should be considered ancestors of HEAD. */
  ancestors?: string[];
  cherryPickHead?: string;
  unmergedFiles?: string[];
  statusPorcelain?: string[];
  /** Merge commit -> [firstParent, secondParent]. */
  mergeParents?: Record<string, [string, string]>;
  /** Commit messages used by crash-recovery provenance checks. */
  commitMessages?: Record<string, string>;
}

/**
 * In-memory GitRunner double. Records every call and returns configured
 * responses so worktree/recorder/integration logic can be tested without
 * touching disk or spawning git.
 */
export class FakeGitRunner implements GitRunner {
  readonly calls: FakeGitCall[] = [];
  readonly heads: Record<string, string>;
  private readonly config: FakeGitRunnerConfig;
  private readonly cherryPickQueue: CherryPickOutcome[];
  private readonly commitQueue: string[];
  private readonly cherryPickResultQueue: string[];
  private readonly parentByCommit = new Map<string, string>();
  private activeCherryPickHead: string | undefined;

  constructor(config: FakeGitRunnerConfig = {}) {
    this.config = config;
    this.heads = { ...(config.heads ?? {}) };
    this.cherryPickQueue = [...(config.cherryPickOutcomes ?? [])];
    this.cherryPickResultQueue = [...(config.cherryPickResultShas ?? [])];
    this.commitQueue = [...(config.commitShas ?? [])];
    this.activeCherryPickHead = config.cherryPickHead;
  }

  private record(op: string, args: Record<string, unknown>): void {
    this.calls.push({ op, args });
    const failure = this.config.failOperations?.[op];
    if (failure) {
      throw failure;
    }
  }

  opsInvoked(): string[] {
    return this.calls.map((call) => call.op);
  }

  async worktreeAdd(params: {
    repoRoot: string;
    worktreePath: string;
    branch: string;
    baseCommit: string;
  }): Promise<void> {
    this.record("worktreeAdd", { ...params });
    this.heads[params.worktreePath] = params.baseCommit;
  }

  async worktreeRemove(params: {
    repoRoot: string;
    worktreePath: string;
    force?: boolean;
  }): Promise<void> {
    this.record("worktreeRemove", { ...params });
  }

  async worktreePrune(repoRoot: string): Promise<void> {
    this.record("worktreePrune", { repoRoot });
  }

  async branchDelete(params: { repoRoot: string; branch: string; force?: boolean }): Promise<void> {
    this.record("branchDelete", { ...params });
  }

  async head(cwd: string): Promise<string> {
    this.record("head", { cwd });
    return this.heads[cwd] ?? "BASE";
  }

  async revParse(cwd: string, ref: string): Promise<string> {
    this.record("revParse", { cwd, ref });
    const commitRef = ref.endsWith("^{commit}") ? ref.slice(0, -"^{commit}".length) : ref;
    const parentMatch = /^(.*)\^(1|2)$/u.exec(commitRef);
    const baseRef = parentMatch?.[1] ?? commitRef;
    if ((this.config.missingRefs ?? []).includes(ref) || (this.config.missingRefs ?? []).includes(baseRef)) {
      throw new Error(`unknown revision ${ref}`);
    }
    if (parentMatch !== null) {
      const parentIndex = Number(parentMatch[2]) - 1;
      const mergeParent = this.config.mergeParents?.[baseRef]?.[parentIndex];
      if (mergeParent !== undefined) return mergeParent;
      if (parentIndex === 1) throw new Error(`unknown revision ${ref}`);
      return this.parentByCommit.get(baseRef) ?? "BASE";
    }
    if (commitRef === "HEAD") return this.heads[cwd] ?? "BASE";
    return commitRef;
  }

  async isAncestor(params: { cwd: string; ancestor: string; descendant?: string }): Promise<boolean> {
    this.record("isAncestor", { ...params });
    if ((this.config.ancestors ?? []).includes(params.ancestor)) return true;
    let current: string | undefined = params.descendant ?? this.heads[params.cwd] ?? "BASE";
    while (current !== undefined) {
      if (current === params.ancestor) return true;
      current = this.parentByCommit.get(current);
    }
    return false;
  }

  async cherryPickHead(cwd: string): Promise<string | undefined> {
    this.record("cherryPickHead", { cwd });
    return this.activeCherryPickHead;
  }

  async unmergedFiles(cwd: string): Promise<string[]> {
    this.record("unmergedFiles", { cwd });
    return this.config.unmergedFiles ?? [];
  }

  async statusPorcelain(cwd: string): Promise<string[]> {
    this.record("statusPorcelain", { cwd });
    return this.config.statusPorcelain ?? [];
  }

  async restoreManagedWorktree(cwd: string, ref: string): Promise<void> {
    this.record("restoreManagedWorktree", { cwd, ref });
    this.heads[cwd] = ref;
  }

  async addAll(cwd: string): Promise<void> {
    this.record("addAll", { cwd });
  }

  async addAllExcluding(cwd: string, excludeGlobs: readonly string[]): Promise<void> {
    this.record("addAllExcluding", { cwd, excludeGlobs: [...excludeGlobs] });
  }

  async commit(params: { cwd: string; message: string }): Promise<string> {
    this.record("commit", { ...params });
    const sha = this.commitQueue.shift() ?? this.config.commitSha ?? "COMMIT_SHA";
    const parent = this.heads[params.cwd] ?? "BASE";
    if (sha !== parent) this.parentByCommit.set(sha, parent);
    this.heads[params.cwd] = sha;
    return sha;
  }

  async commitMessage(cwd: string, commitSha: string): Promise<string> {
    this.record("commitMessage", { cwd, commitSha });
    return this.config.commitMessages?.[commitSha] ?? "";
  }

  async diffCached(cwd: string): Promise<string> {
    this.record("diffCached", { cwd });
    return this.config.diffCached ?? "";
  }

  async diffCachedNameOnly(cwd: string): Promise<string[]> {
    this.record("diffCachedNameOnly", { cwd });
    return this.config.diffCachedNameOnly ?? [];
  }

  async diffCachedAddedFiles(cwd: string): Promise<string[]> {
    this.record("diffCachedAddedFiles", { cwd });
    return this.config.diffCachedAddedFiles ?? [];
  }

  async diffCachedNumstat(cwd: string): Promise<number> {
    this.record("diffCachedNumstat", { cwd });
    return this.config.diffCachedNumstat ?? 0;
  }

  async diffRange(params: { cwd: string; from: string; to: string }): Promise<string> {
    this.record("diffRange", { ...params });
    return this.config.diffRange ?? "";
  }

  async diffRangeNameOnly(params: { cwd: string; from: string; to: string }): Promise<string[]> {
    this.record("diffRangeNameOnly", { ...params });
    return this.config.diffRangeNameOnly ?? [];
  }

  async diffRangeAddedFiles(params: { cwd: string; from: string; to: string }): Promise<string[]> {
    this.record("diffRangeAddedFiles", { ...params });
    return this.config.diffRangeAddedFiles ?? [];
  }

  async diffRangeNumstat(params: { cwd: string; from: string; to: string }): Promise<number> {
    this.record("diffRangeNumstat", { ...params });
    return this.config.diffRangeNumstat ?? 0;
  }

  async cherryPick(params: { cwd: string; commitSha: string; mainline?: 1 }): Promise<CherryPickOutcome> {
    this.record("cherryPick", { ...params });
    const outcome = this.cherryPickQueue.shift() ?? { ok: true, conflictFiles: [], output: "" };
    if (outcome.ok) {
      this.activeCherryPickHead = undefined;
      const resultSha = this.cherryPickResultQueue.shift();
      if (resultSha !== undefined) {
        const parent = this.heads[params.cwd] ?? "BASE";
        this.parentByCommit.set(resultSha, parent);
        this.heads[params.cwd] = resultSha;
      }
    } else if (outcome.kind === "conflict" || (outcome.kind === undefined && outcome.conflictFiles.length > 0)) {
      this.activeCherryPickHead = params.commitSha;
    } else if (outcome.kind === "empty") {
      this.activeCherryPickHead = params.commitSha;
    }
    return outcome;
  }

  async cherryPickAbort(cwd: string): Promise<void> {
    this.record("cherryPickAbort", { cwd });
    this.activeCherryPickHead = undefined;
  }

  async createIntegrationHandoff(params: {
    cwd: string;
    baseCommit: string;
    message: string;
    appliedCommitShas: readonly string[];
  }): Promise<string> {
    this.record("createIntegrationHandoff", { ...params, appliedCommitShas: [...params.appliedCommitShas] });
    return this.heads[params.cwd] ?? params.baseCommit;
  }

  async showFile(params: { cwd: string; ref: string; path: string }): Promise<string | null> {
    this.record("showFile", { ...params });
    return this.config.showFileByRef?.[params.ref]?.[params.path] ?? this.config.showFile?.[params.path] ?? null;
  }
}
