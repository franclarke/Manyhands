import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import type { EffortLevel } from "@manyhands/shared";
import {
  killCliProcessTree,
  resolveCliBinaryPath,
  resolveCliProcessInvocation
} from "@manyhands/shared/node-cli-process";

import type { Decomposer, DecompositionOptions, DecompositionResult, FeatureRequest } from "../../index";
import type { AnthropicLike } from "../anthropic-decomposer";
import { DecomposerLlmError } from "../errors";
import {
  RecursiveDecomposer,
  type RecursiveDecomposerOptions,
  type RecursiveStepCompletedEvent,
  type RecursiveStepListener,
  type RecursiveStepStartedEvent,
  type RecursiveStepStatusEvent
} from "./recursive-decomposer";
import { RECURSIVE_DECOMPOSER_PROMPT_VERSION, type Aggressiveness } from "./step-prompt";

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface CodexRecursiveDecomposerOptions {
  model: string;
  userPrompt: string;
  cwd: string;
  reasoningEffort?: CodexReasoningEffort;
  binaryPath?: string;
  timeoutMs?: number;
  workspaceHints?: string;
  aggressiveness?: Aggressiveness;
  depthBudget?: number;
  maxParallelSteps?: number;
  maxChildrenPerNode?: number;
  maxDecomposerCalls?: number;
  maxStepAttempts?: number;
  stepRetryBaseDelayMs?: number;
  stepRetryMaxDelayMs?: number;
  allowNonRootFallback?: boolean;
  promptTemplateVersion?: string;
  onStepStarted?: RecursiveStepListener<RecursiveStepStartedEvent>;
  onStepCompleted?: RecursiveStepListener<RecursiveStepCompletedEvent>;
  onStepStatus?: RecursiveStepListener<RecursiveStepStatusEvent>;
  spawn?: SpawnFn;
  /** Legacy test seam; structured CLI argv is always spawned without Node shell interpolation. */
  useShell?: boolean;
  platform?: NodeJS.Platform;
  hostEnv?: NodeJS.ProcessEnv;
  /** Filtered environment for spawned agent processes. Defaults to process.env. */
  agentEnv?: Record<string, string>;
  onCliOutput?: (data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void;
}

type CodexReasoningEffort = EffortLevel;

const DEFAULT_TIMEOUT_MS = 120_000;
const SPAWN_FAILURE_EXIT_CODE = 127;
const TIMEOUT_EXIT_CODE = 124;

/**
 * Recursive decomposer backed by the local Codex CLI, not a hosted API.
 * The RecursiveDecomposer owns recursion, validation and retries; this adapter
 * only supplies one step client backed by `codex` executing in workspace-write mode.
 */
export class CodexRecursiveDecomposer implements Decomposer {
  private readonly inner: RecursiveDecomposer;
  public readonly model: string;
  public readonly promptTemplateVersion: string;
  private readonly agentEnv: Record<string, string> | NodeJS.ProcessEnv;

  constructor(options: CodexRecursiveDecomposerOptions) {
    this.model = options.model;
    this.agentEnv = options.agentEnv ?? process.env;
    this.promptTemplateVersion =
      options.promptTemplateVersion ?? `${RECURSIVE_DECOMPOSER_PROMPT_VERSION}.codex`;

    const clientOptions: CodexStepClientOptions = {
      model: options.model,
      cwd: options.cwd
    };
    if (options.reasoningEffort !== undefined) clientOptions.reasoningEffort = options.reasoningEffort;
    if (options.binaryPath !== undefined) clientOptions.binaryPath = options.binaryPath;
    if (options.timeoutMs !== undefined) clientOptions.timeoutMs = options.timeoutMs;
    if (options.spawn !== undefined) clientOptions.spawn = options.spawn;
    if (options.platform !== undefined) clientOptions.platform = options.platform;
    if (options.hostEnv !== undefined) clientOptions.hostEnv = options.hostEnv;
    if (options.agentEnv !== undefined) clientOptions.agentEnv = options.agentEnv;
    if (options.onCliOutput !== undefined) clientOptions.onCliOutput = options.onCliOutput;
    const client = new CodexStepClient(clientOptions);

    const recursiveOptions: RecursiveDecomposerOptions = {
      client,
      model: options.model,
      userPrompt: options.userPrompt,
      promptTemplateVersion: this.promptTemplateVersion
    };
    if (options.workspaceHints !== undefined) recursiveOptions.workspaceHints = options.workspaceHints;
    if (options.aggressiveness !== undefined) recursiveOptions.aggressiveness = options.aggressiveness;
    if (options.depthBudget !== undefined) recursiveOptions.depthBudget = options.depthBudget;
    if (options.maxParallelSteps !== undefined) recursiveOptions.maxParallelSteps = options.maxParallelSteps;
    if (options.maxChildrenPerNode !== undefined) recursiveOptions.maxChildrenPerNode = options.maxChildrenPerNode;
    if (options.maxDecomposerCalls !== undefined) recursiveOptions.maxDecomposerCalls = options.maxDecomposerCalls;
    if (options.maxStepAttempts !== undefined) recursiveOptions.maxStepAttempts = options.maxStepAttempts;
    if (options.stepRetryBaseDelayMs !== undefined) recursiveOptions.stepRetryBaseDelayMs = options.stepRetryBaseDelayMs;
    if (options.stepRetryMaxDelayMs !== undefined) recursiveOptions.stepRetryMaxDelayMs = options.stepRetryMaxDelayMs;
    if (options.allowNonRootFallback !== undefined) recursiveOptions.allowNonRootFallback = options.allowNonRootFallback;
    if (options.onStepStarted !== undefined) recursiveOptions.onStepStarted = options.onStepStarted;
    if (options.onStepCompleted !== undefined) recursiveOptions.onStepCompleted = options.onStepCompleted;
    if (options.onStepStatus !== undefined) recursiveOptions.onStepStatus = options.onStepStatus;
    this.inner = new RecursiveDecomposer(recursiveOptions);
  }

  decompose(input: FeatureRequest, options?: DecompositionOptions): Promise<DecompositionResult> {
    return this.inner.decompose(input, options);
  }

  executeStep(...args: Parameters<RecursiveDecomposer["executeStep"]>): ReturnType<RecursiveDecomposer["executeStep"]> {
    return this.inner.executeStep(...args);
  }

  reconstructGraph(...args: Parameters<RecursiveDecomposer["reconstructGraph"]>): ReturnType<RecursiveDecomposer["reconstructGraph"]> {
    return this.inner.reconstructGraph(...args);
  }
}

interface CodexStepClientOptions {
  model: string;
  cwd: string;
  reasoningEffort?: CodexReasoningEffort;
  binaryPath?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  platform?: NodeJS.Platform;
  hostEnv?: NodeJS.ProcessEnv;
  /** Filtered environment for spawned agent processes. Defaults to process.env. */
  agentEnv?: Record<string, string>;
  onCliOutput?: ((data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void) | undefined;
}

class CodexStepClient implements AnthropicLike {
  readonly messages: AnthropicLike["messages"];
  private readonly model: string;
  private readonly cwd: string;
  private readonly reasoningEffort: CodexReasoningEffort | undefined;
  private readonly binaryPath: string;
  private readonly timeoutMs: number;
  private readonly spawnFn: SpawnFn;
  private readonly platform: NodeJS.Platform;
  private readonly hostEnv: NodeJS.ProcessEnv;
  private readonly agentEnv: Record<string, string> | NodeJS.ProcessEnv;
  private readonly onCliOutput?: ((data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void) | undefined;

  constructor(options: CodexStepClientOptions) {
    this.model = options.model;
    this.cwd = options.cwd;
    this.reasoningEffort = options.reasoningEffort;
    this.platform = options.platform ?? process.platform;
    this.hostEnv = options.hostEnv ?? process.env;
    this.agentEnv = options.agentEnv ?? process.env;
    this.binaryPath = resolveCliBinaryPath(
      options.binaryPath ?? this.hostEnv.MANYHANDS_CODEX_BIN ?? "codex",
      { platform: this.platform, env: this.hostEnv }
    );
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnFn = options.spawn ?? spawn;
    this.onCliOutput = options.onCliOutput;
    this.messages = {
      create: async (args: Parameters<AnthropicLike["messages"]["create"]>[0]) => {
        const systemPrompt = [
          "CRITICAL: Do NOT call any tools. Do not search for files, do not read files, do not run grep, and do not execute any commands. All required context is fully provided in the prompt text.",
          "Analyze the input text locally and return strictly the JSON matching the schema.",
          args.system
        ].join("\n\n");
        const prompt = [
          "## System",
          systemPrompt,
          "",
          "## User",
          args.messages.map((message) => message.content).join("\n\n")
        ].join("\n");
        const text = await this.runCodex(prompt, args.nodeId);
        return { content: [{ type: "text", text }] };
      }
    };
  }

  private async runCodex(prompt: string, nodeId?: string): Promise<string> {
    const args = [
      "exec",
      "--model",
      this.model,
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      ...(this.reasoningEffort !== undefined ? ["-c", `model_reasoning_effort="${this.reasoningEffort}"`] : []),
      "-"
    ];

    const invocation = resolveCliProcessInvocation(this.binaryPath, args, {
      platform: this.platform,
      env: this.hostEnv
    });
    const outcome = await spawnCodex({
      binaryPath: invocation.command,
      args: invocation.args,
      cwd: this.cwd,
      prompt,
      timeoutMs: this.timeoutMs,
      spawnFn: this.spawnFn,
      platform: this.platform,
      env: this.agentEnv,
      ...(invocation.windowsVerbatimArguments !== undefined
        ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments }
        : {}),
      onChunk: (chunk, stream) => {
        if (this.onCliOutput !== undefined && nodeId !== undefined) {
          this.onCliOutput({ nodeId, chunk, stream });
        }
      }
    });

    if (outcome.timedOut) {
      const message = `Codex recursive planning timed out after ${this.timeoutMs}ms`;
      throw new DecomposerLlmError(message, undefined, "request", {
        kind: "provider_timeout",
        stage: "request",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }
    if (outcome.exitCode !== 0) {
      const message = `Codex recursive planning failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`;
      throw new DecomposerLlmError(message, undefined, "request", {
        kind: "provider_request",
        stage: "request",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }

    // Codex returns raw text on stdout. We return it directly.
    return outcome.stdout;
  }
}

interface SpawnCodexInput {
  binaryPath: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  spawnFn: SpawnFn;
  platform: NodeJS.Platform;
  env: Record<string, string> | NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
}

interface SpawnCodexOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function spawnCodex(input: SpawnCodexInput): Promise<SpawnCodexOutcome> {
  return new Promise((resolve) => {
    const child = input.spawnFn(input.binaryPath, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: input.platform !== "win32",
      ...(input.windowsVerbatimArguments !== undefined
        ? { windowsVerbatimArguments: input.windowsVerbatimArguments }
        : {})
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminating = false;

    const finish = (outcome: SpawnCodexOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      if (settled || terminating) return;
      terminating = true;
      void killCliProcessTree(child, input.spawnFn, input.platform).then((terminationVerified) => {
        finish({
          exitCode: TIMEOUT_EXIT_CODE,
          stdout,
          stderr:
            stderr +
            (terminationVerified
              ? ""
              : `${stderr ? "\n" : ""}process-tree termination could not be verified`),
          timedOut: true
        });
      });
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      input.onChunk?.(text, "stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      input.onChunk?.(text, "stderr");
    });
    child.on("error", (error: Error) => {
      if (terminating) return;
      finish({
        exitCode: SPAWN_FAILURE_EXIT_CODE,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + error.message,
        timedOut: false
      });
    });
    child.on("close", (code) => {
      if (terminating) return;
      finish({ exitCode: code ?? SPAWN_FAILURE_EXIT_CODE, stdout, stderr, timedOut: false });
    });

    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.prompt);
  });
}
