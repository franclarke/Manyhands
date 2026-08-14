import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { AgentExecutorOptions } from "../types";
import { resolveCliBinaryPath, resolveCliProcessInvocation } from "./binary";
import { getExecutorDescriptor, type ExecutorId } from "./registry";
import { createAgentStatusScanner } from "./status-channel";
import { spawnExecutorProcess, type SpawnFn } from "./process";
import type { AgentExecutor, ExecutorRunOutcome } from "./types";

/**
 * Everything that distinguishes one agent CLI from another. The executors are
 * data, not classes: one engine (CliAgentExecutor) drives every CLI through
 * its profile — argv shape, structured-output parsing, log scope. Adding a
 * new CLI is a new profile plus a registry descriptor; no factory edits.
 */
export interface CliExecutorProfile {
  id: ExecutorId;
  /** Scope used for spawn-lifecycle logs ("gemini", "claude", "codex"). */
  logScope: string;
  /** Pure argv builder — unit-testable without spawning. */
  buildArgs(options: AgentExecutorOptions): string[];
  /**
   * Optional post-processor for the raw outcome: extract reported token usage
   * and cost, replace machine envelopes (JSON) with the human response text,
   * and surface structured provider errors on stderr. Must be total — return
   * the outcome untouched when the output is not in the expected shape.
   */
  parseOutcome?(outcome: ExecutorRunOutcome, options: AgentExecutorOptions): ExecutorRunOutcome;
}

export interface CliExecutorDeps {
  /** CLI binary. Defaults to the registry's env var, then its default binary name. */
  binaryPath?: string;
  /** Injectable spawn for tests. Defaults to node:child_process spawn. */
  spawn?: SpawnFn;
  /** Injectable instructions reader for tests. Defaults to fs.readFile (utf8). */
  readInstructions?: (filePath: string) => Promise<string>;
  /**
   * Run through a shell. Defaults to false because executor profiles pass
   * structured argv and current Codex/Claude binaries are directly spawnable.
   */
  useShell?: boolean;
  /** Injectable host platform/environment for deterministic process tests. */
  platform?: NodeJS.Platform;
  hostEnv?: NodeJS.ProcessEnv;
}

/**
 * The single real AgentExecutor implementation. Delegates process mechanics to
 * the shared `spawnExecutorProcess` driver (stdin-fed instructions, hard
 * timeout, process-tree teardown on timeout/abort), taps stdout for the
 * MH_STATUS send-to-user channel, and applies the profile's structured-output
 * parser before returning. Process-level failures (binary missing, spawn
 * error) surface as non-zero outcomes so the seam stays total.
 */
export class CliAgentExecutor implements AgentExecutor {
  readonly profile: CliExecutorProfile;
  readonly binaryPath: string;
  private readonly spawnFn: SpawnFn;
  private readonly readInstructions: (filePath: string) => Promise<string>;
  private readonly platform: NodeJS.Platform;
  private readonly hostEnv: NodeJS.ProcessEnv;

  constructor(profile: CliExecutorProfile, deps: CliExecutorDeps = {}) {
    const descriptor = getExecutorDescriptor(profile.id);
    this.profile = profile;
    this.platform = deps.platform ?? process.platform;
    this.hostEnv = deps.hostEnv ?? process.env;
    this.binaryPath = resolveCliBinaryPath(
      deps.binaryPath ?? this.hostEnv[descriptor.binaryEnvVar] ?? descriptor.defaultBinary,
      { platform: this.platform, env: this.hostEnv }
    );
    this.spawnFn = deps.spawn ?? spawn;
    this.readInstructions = deps.readInstructions ?? ((filePath) => readFile(filePath, "utf8"));
  }

  async execute(options: AgentExecutorOptions): Promise<ExecutorRunOutcome> {
    const statusScanner =
      options.onAgentStatus !== undefined ? createAgentStatusScanner(options.onAgentStatus) : undefined;

    const onOutput =
      statusScanner === undefined
        ? options.onOutput
        : (chunk: { stream: "stdout" | "stderr"; chunk: string }): void => {
            if (chunk.stream === "stdout") {
              statusScanner(chunk.chunk);
            }
            options.onOutput?.(chunk);
          };

    const invocation = resolveCliProcessInvocation(this.binaryPath, this.profile.buildArgs(options), {
      platform: this.platform,
      env: this.hostEnv
    });
    const outcome = await spawnExecutorProcess({
      binaryPath: invocation.command,
      args: invocation.args,
      cwd: options.cwd,
      env: options.env,
      isolatedEnvironment: options.isolatedEnvironment,
      useShell: invocation.shell,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      processOwnerId: options.processOwnerId,
      attemptId: options.attemptId,
      spawnFn: this.spawnFn,
      readInstructions: this.readInstructions,
      instructionFilePath: options.instructionFilePath,
      logScope: this.profile.logScope,
      onOutput
    });
    statusScanner?.flush();

    return this.profile.parseOutcome?.(outcome, options) ?? outcome;
  }
}
