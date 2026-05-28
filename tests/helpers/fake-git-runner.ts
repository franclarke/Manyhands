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
  diffCached?: string;
  diffCachedNameOnly?: string[];
  diffCachedNumstat?: number;
  /** Dequeued one per cherryPick() call; defaults to a clean success. */
  cherryPickOutcomes?: CherryPickOutcome[];
  /** Operations that should throw when invoked. */
  failOperations?: Partial<Record<string, Error>>;
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

  constructor(config: FakeGitRunnerConfig = {}) {
    this.config = config;
    this.heads = { ...(config.heads ?? {}) };
    this.cherryPickQueue = [...(config.cherryPickOutcomes ?? [])];
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

  async branchDelete(params: { repoRoot: string; branch: string; force?: boolean }): Promise<void> {
    this.record("branchDelete", { ...params });
  }

  async head(cwd: string): Promise<string> {
    this.record("head", { cwd });
    return this.heads[cwd] ?? "BASE";
  }

  async revParse(cwd: string, ref: string): Promise<string> {
    this.record("revParse", { cwd, ref });
    return this.heads[cwd] ?? "BASE";
  }

  async addAll(cwd: string): Promise<void> {
    this.record("addAll", { cwd });
  }

  async commit(params: { cwd: string; message: string }): Promise<string> {
    this.record("commit", { ...params });
    const sha = this.config.commitSha ?? "COMMIT_SHA";
    this.heads[params.cwd] = sha;
    return sha;
  }

  async diffCached(cwd: string): Promise<string> {
    this.record("diffCached", { cwd });
    return this.config.diffCached ?? "";
  }

  async diffCachedNameOnly(cwd: string): Promise<string[]> {
    this.record("diffCachedNameOnly", { cwd });
    return this.config.diffCachedNameOnly ?? [];
  }

  async diffCachedNumstat(cwd: string): Promise<number> {
    this.record("diffCachedNumstat", { cwd });
    return this.config.diffCachedNumstat ?? 0;
  }

  async cherryPick(params: { cwd: string; commitSha: string }): Promise<CherryPickOutcome> {
    this.record("cherryPick", { ...params });
    return this.cherryPickQueue.shift() ?? { ok: true, conflictFiles: [], output: "" };
  }

  async cherryPickAbort(cwd: string): Promise<void> {
    this.record("cherryPickAbort", { cwd });
  }
}
