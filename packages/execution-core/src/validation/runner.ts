import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import { validationCommandSafetyIssues, type ExecutionValidationCommand } from "@manyhands/contracts";

import { killProcessTree } from "../executor/kill";
import { resolveCliBinaryPath, resolveCliProcessInvocation } from "../executor/binary";
import { superviseChildProcess } from "../executor/live-process-registry";
import { BoundedOutput } from "../executor/bounded-output";
import { ValidationRunResultSchema, type ValidationRunResult } from "../types";

/** B-005: ties validation subprocesses to their run for cancel/kill/report. */
export interface ValidationSupervision {
  runId: string;
  operationId?: string;
  /** Aborting kills the current command's process tree and fails the run. */
  signal?: AbortSignal;
}

export interface ValidationRunContext {
  /** Worktree the task ran in; used when a command's cwd is "worktree". */
  worktreePath: string;
  /** Repo root; used when a command's cwd is "repo-root". */
  repoRoot: string;
  supervision?: ValidationSupervision;
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
  /** @deprecated Structured validation argv is never passed to Node shell interpolation. */
  useShell?: boolean;
  /** Injectable platform for Windows shim tests. Defaults to process.platform. */
  platform?: NodeJS.Platform;
  hostEnv?: NodeJS.ProcessEnv;
}

const TIMEOUT_EXIT_CODE = 124;
const UNSAFE_COMMAND_EXIT_CODE = 126;
const SPAWN_FAILURE_EXIT_CODE = 127;
const ABORTED_EXIT_CODE = 130;

// Under a shell a missing binary no longer surfaces as a spawn `error` event:
// the shell itself exits non-zero with a "not found" message. Normalize that
// back to 127 so failure classification can still tell "binary missing" (infra)
// apart from "tests failed" (code).
//
// The TypeScript clause covers a sharper trap: a project with no local
// TypeScript runs `npx tsc`, which resolves to the squatted `tsc` npm package.
// It exits 1 with "This is not the tsc command you are looking for" — a missing
// toolchain, not a type error. Treat it as infra (127), never as broken code.
const BINARY_NOT_FOUND_PATTERN =
  /is not recognized as an internal or external command|command not found|no se reconoce como un comando interno o externo|this is not the tsc command you are looking for|to get access to the typescript compiler/i;

/** ValidationRunner backed by child processes. spawn is injectable for tests. */
export class ChildProcessValidationRunner implements ValidationRunner {
  private readonly spawnFn: SpawnFn;
  private readonly platform: NodeJS.Platform;
  private readonly hostEnv: NodeJS.ProcessEnv;

  constructor(deps: ChildProcessValidationRunnerDeps = {}) {
    this.spawnFn = deps.spawn ?? spawn;
    this.platform = deps.platform ?? process.platform;
    this.hostEnv = deps.hostEnv ?? process.env;
  }

  async run(
    commands: ExecutionValidationCommand[],
    ctx: ValidationRunContext
  ): Promise<ValidationRunResult> {
    const aggregatedOutput = new BoundedOutput();

    for (const command of commands) {
      if (ctx.supervision?.signal?.aborted === true) {
        return ValidationRunResultSchema.parse({
          passed: false,
          output: `${aggregatedOutput.text()}validation aborted (run cancelled)`,
          exitCode: ABORTED_EXIT_CODE
        });
      }
      const cwd = command.cwd === "repo-root" ? ctx.repoRoot : ctx.worktreePath;
      const result = await this.runOne(command, cwd, ctx.supervision);
      aggregatedOutput.append(result.output);
      if (result.exitCode !== 0) {
        return ValidationRunResultSchema.parse({
          passed: false,
          output: aggregatedOutput.text(),
          exitCode: result.exitCode
        });
      }
    }

    return ValidationRunResultSchema.parse({
      passed: true,
      output: aggregatedOutput.text(),
      exitCode: 0
    });
  }

  private runOne(
    command: ExecutionValidationCommand,
    cwd: string,
    supervision?: ValidationSupervision
  ): Promise<{ exitCode: number; output: string }> {
    const spawnCommand = this.buildSpawnCommand(command);
    const safetyIssues = validationCommandSafetyIssues(command.command, command.args, {
      shell: false
    });
    if (safetyIssues.length > 0) {
      return Promise.resolve({
        exitCode: UNSAFE_COMMAND_EXIT_CODE,
        output: `validation command rejected (unsafe): ${safetyIssues.join("; ")} — fix the plan's validation commands`
      });
    }
    if (supervision?.signal?.aborted === true) {
      return Promise.resolve({
        exitCode: ABORTED_EXIT_CODE,
        output: "validation aborted (run cancelled)"
      });
    }

    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnFn(spawnCommand.command, spawnCommand.args, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          detached: this.platform !== "win32",
          ...(spawnCommand.windowsVerbatimArguments !== undefined
            ? { windowsVerbatimArguments: spawnCommand.windowsVerbatimArguments }
            : {})
        });
      } catch (error) {
        resolve({
          exitCode: SPAWN_FAILURE_EXIT_CODE,
          output: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      if (supervision !== undefined) {
        superviseChildProcess(
          {
            runId: supervision.runId,
            label: "validation",
            ...(supervision.operationId !== undefined ? { operationId: supervision.operationId } : {})
          },
          child,
          {
            ...(supervision.signal !== undefined ? { signal: supervision.signal } : {}),
            spawnFn: this.spawnFn
          }
        );
      }

      const output = new BoundedOutput();
      let settled = false;
      let terminating = false;

      const finish = (result: { exitCode: number; output: string }): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        if (settled || terminating) return;
        terminating = true;
        void killProcessTree(child, this.spawnFn).then((terminationVerified) => {
          finish({
            exitCode: TIMEOUT_EXIT_CODE,
            output:
              output.text() +
              (terminationVerified
                ? ""
                : `${output.text() ? "\n" : ""}process-tree termination could not be verified`)
          });
        });
      }, command.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        output.append(chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output.append(chunk.toString("utf8"));
      });
      child.on("error", (error: Error) => {
        if (terminating) return;
        output.append(error.message);
        finish({ exitCode: SPAWN_FAILURE_EXIT_CODE, output: output.text() });
      });
      child.on("close", (code) => {
        if (terminating) return;
        const exitCode = code ?? SPAWN_FAILURE_EXIT_CODE;
        const captured = output.text();
        if (exitCode !== 0 && BINARY_NOT_FOUND_PATTERN.test(captured)) {
          finish({ exitCode: SPAWN_FAILURE_EXIT_CODE, output: captured });
          return;
        }
        finish({ exitCode, output: captured });
      });
    });
  }

  private buildSpawnCommand(command: ExecutionValidationCommand): {
    command: string;
    args: readonly string[];
    windowsVerbatimArguments?: boolean;
  } {
    const binaryPath = resolveCliBinaryPath(command.command, {
      platform: this.platform,
      env: this.hostEnv
    });
    return resolveCliProcessInvocation(binaryPath, command.args, {
      platform: this.platform,
      env: this.hostEnv
    });
  }
}
