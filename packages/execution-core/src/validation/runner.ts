import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import { validationCommandSafetyIssues, type ExecutionValidationCommand } from "@manyhands/contracts";

import { killProcessTree } from "../executor/kill";
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
  /** Run commands through a shell. Defaults to true on Windows, where npm/pnpm/npx are .cmd shims spawn() can't exec directly. */
  useShell?: boolean;
}

const TIMEOUT_EXIT_CODE = 124;
const UNSAFE_COMMAND_EXIT_CODE = 126;
const SPAWN_FAILURE_EXIT_CODE = 127;

// Under a shell a missing binary no longer surfaces as a spawn `error` event:
// the shell itself exits non-zero with a "not found" message. Normalize that
// back to 127 so failure classification can still tell "binary missing" (infra)
// apart from "tests failed" (code).
const BINARY_NOT_FOUND_PATTERN =
  /is not recognized as an internal or external command|command not found|no se reconoce como un comando interno o externo/i;

/** ValidationRunner backed by child processes. spawn is injectable for tests. */
export class ChildProcessValidationRunner implements ValidationRunner {
  private readonly spawnFn: SpawnFn;
  private readonly useShell: boolean;

  constructor(deps: ChildProcessValidationRunnerDeps = {}) {
    this.spawnFn = deps.spawn ?? spawn;
    this.useShell = deps.useShell ?? process.platform === "win32";
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
    const safetyIssues = validationCommandSafetyIssues(command.command, command.args);
    if (safetyIssues.length > 0) {
      return Promise.resolve({
        exitCode: UNSAFE_COMMAND_EXIT_CODE,
        output: `validation command rejected (unsafe): ${safetyIssues.join("; ")} — fix the plan's validation commands`
      });
    }

    return new Promise((resolve) => {
      const child = this.spawnFn(command.command, command.args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: this.useShell
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
        killProcessTree(child, this.spawnFn);
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
        const exitCode = code ?? SPAWN_FAILURE_EXIT_CODE;
        if (exitCode !== 0 && BINARY_NOT_FOUND_PATTERN.test(output)) {
          finish({ exitCode: SPAWN_FAILURE_EXIT_CODE, output });
          return;
        }
        finish({ exitCode, output });
      });
    });
  }
}
