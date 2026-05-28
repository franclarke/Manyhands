import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CodexCliExecutorOptions } from "../types";
import type { CodexExecutor, CodexRunOutcome } from "./types";

/** Deterministic script for what a mocked Codex run should do in a worktree. */
export interface MockCodexBehavior {
  /** Files to write into the worktree (relative path -> content). Simulates the diff. */
  filesToWrite?: Record<string, string>;
  exitCode?: number;
  timedOut?: boolean;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  /** Simulate Codex committing on its own (D6 violation). Requires `committer`. */
  commitUnexpectedly?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

export interface MockCodexCliExecutorDeps {
  /** Behaviors keyed by worktree path (`options.cwd`). */
  behaviors?: Record<string, MockCodexBehavior>;
  /** Behavior used when no entry matches. Default: empty diff, exit 0. */
  defaultBehavior?: MockCodexBehavior;
  /** Invoked when a behavior sets `commitUnexpectedly`, to make a real commit in E2E. */
  committer?: (cwd: string) => Promise<void>;
}

/**
 * Deterministic CodexExecutor double. Instead of invoking `codex exec`, it
 * writes the configured files into the worktree so the downstream ResultRecorder
 * observes a real `git diff`. Covers the full test suite (D-E2).
 */
export class MockCodexCliExecutor implements CodexExecutor {
  readonly calls: CodexCliExecutorOptions[] = [];
  private readonly behaviors: Record<string, MockCodexBehavior>;
  private readonly defaultBehavior: MockCodexBehavior;
  private readonly committer: ((cwd: string) => Promise<void>) | undefined;

  constructor(deps: MockCodexCliExecutorDeps = {}) {
    this.behaviors = deps.behaviors ?? {};
    this.defaultBehavior = deps.defaultBehavior ?? {};
    this.committer = deps.committer;
  }

  async execute(options: CodexCliExecutorOptions): Promise<CodexRunOutcome> {
    this.calls.push(options);
    const start = Date.now();
    const behavior = this.behaviors[options.cwd] ?? this.defaultBehavior;

    for (const [relativePath, content] of Object.entries(behavior.filesToWrite ?? {})) {
      const absolute = join(options.cwd, relativePath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content, "utf8");
    }

    if (behavior.commitUnexpectedly) {
      if (!this.committer) {
        throw new Error("MockCodexBehavior.commitUnexpectedly requires a committer dependency");
      }
      await this.committer(options.cwd);
    }

    const outcome: CodexRunOutcome = {
      exitCode: behavior.exitCode ?? 0,
      stdout: behavior.stdout ?? "",
      stderr: behavior.stderr ?? "",
      timedOut: behavior.timedOut ?? false,
      durationMs: behavior.durationMs ?? Date.now() - start
    };

    if (behavior.tokensIn !== undefined) {
      outcome.tokensIn = behavior.tokensIn;
    }
    if (behavior.tokensOut !== undefined) {
      outcome.tokensOut = behavior.tokensOut;
    }
    if (behavior.costUsd !== undefined) {
      outcome.costUsd = behavior.costUsd;
    }

    return outcome;
  }
}
