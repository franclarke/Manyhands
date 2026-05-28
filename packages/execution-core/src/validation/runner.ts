import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import type { ExecutionValidationCommand } from "@manyhands/contracts";

import { ValidationRunResultSchema, type ValidationRunResult } from "../types";

export interface ValidationRunContext {
  /** Worktree the task ran in; used when a command's cwd is "worktree". */
  worktreePath: string;
  /** Repo root; used when a command's cwd is "repo-root". */
  repoRoot: string;
}

/**
 * Runs a contract's validation commands (leaf / parent / run) and reports a
 * single pass/fail. Stops at the first failing command so callers see the
 * earliest failure, mirroring how a CI step short-circuits.
 */
export interface ValidationRunner {
  run(
    commands: ExecutionValidationCommand[],
    ctx: ValidationRunContext
  ): Promise<ValidationRunResult>;
}

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface ChildProcessValidationRunnerDeps {
  spawn?: SpawnFn;
}

const TIMEOUT_EXIT_CODE = 124;
const SPAWN_FAILURE_EXIT_CODE = 127;

/** ValidationRunner backed by child processes. spawn is injectable for tests. */
export class ChildProcessValidationRunner implements ValidationRunner {
  private readonly spawnFn: SpawnFn;

  constructor(deps: ChildProcessValidationRunnerDeps = {}) {
    this.spawnFn = deps.spawn ?? spawn;
  }

  async run(
    commands: ExecutionValidationCommand[],
    ctx: ValidationRunContext
  ): Promise<ValidationRunResult> {
    let aggregatedOutput = "";

    for (const command of commands) {
      const cwd = command.cwd === "repo-root" ? ctx.repoRoot : ctx.worktreePath;
      const result = await this.runOne(command, cwd);
      aggregatedOutput += result.output;
      if (result.exitCode !== 0) {
        return ValidationRunResultSchema.parse({
          passed: false,
          output: aggregatedOutput,
          exitCode: result.exitCode
        });
      }
    }

    return ValidationRunResultSchema.parse({
      passed: true,
      output: aggregatedOutput,
      exitCode: 0
    });
  }

  private runOne(
    command: ExecutionValidationCommand,
    cwd: string
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
      const child = this.spawnFn(command.command, command.args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let output = "";
      let settled = false;

      const finish = (result: { exitCode: number; output: string }): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ exitCode: TIMEOUT_EXIT_CODE, output });
      }, command.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.on("error", (error: Error) => {
        finish({ exitCode: SPAWN_FAILURE_EXIT_CODE, output: output + error.message });
      });
      child.on("close", (code) => {
        finish({ exitCode: code ?? SPAWN_FAILURE_EXIT_CODE, output });
      });
    });
  }
}
