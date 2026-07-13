import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
import { parseJsonObject } from "./json";
import { RECURSIVE_DECOMPOSER_PROMPT_VERSION, type Aggressiveness } from "./step-prompt";

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface ClaudeCodeRecursiveDecomposerOptions {
  model: string;
  userPrompt: string;
  cwd: string;
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
  useShell?: boolean;
  onCliOutput?: (data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const SPAWN_FAILURE_EXIT_CODE = 127;
const TIMEOUT_EXIT_CODE = 124;

/**
 * Claude Code print mode (`-p`) with `--output-format json` runs one headless
 * turn and emits a `{ type:"result", result, is_error }` envelope on stdout.
 * `--permission-mode plan` keeps the model read-only while it grounds interface
 * decisions. The full planning prompt arrives over stdin (no arg-length limit);
 * this directive only triggers headless print mode.
 */
const STDIN_DIRECTIVE = "Follow the planning instructions provided on stdin.";

/**
 * Recursive decomposer backed by the local Claude Code CLI, not a hosted API.
 * The RecursiveDecomposer owns recursion, validation and retries; this adapter
 * only supplies one step client backed by `claude` in read-only plan mode.
 */
export class ClaudeCodeRecursiveDecomposer implements Decomposer {
  private readonly inner: RecursiveDecomposer;
  public readonly model: string;
  public readonly promptTemplateVersion: string;

  constructor(options: ClaudeCodeRecursiveDecomposerOptions) {
    this.model = options.model;
    this.promptTemplateVersion =
      options.promptTemplateVersion ?? `${RECURSIVE_DECOMPOSER_PROMPT_VERSION}.claude-code`;

    const clientOptions: ClaudeCodeStepClientOptions = {
      model: options.model,
      cwd: options.cwd
    };
    if (options.binaryPath !== undefined) clientOptions.binaryPath = options.binaryPath;
    if (options.timeoutMs !== undefined) clientOptions.timeoutMs = options.timeoutMs;
    if (options.spawn !== undefined) clientOptions.spawn = options.spawn;
    if (options.useShell !== undefined) clientOptions.useShell = options.useShell;
    if (options.onCliOutput !== undefined) clientOptions.onCliOutput = options.onCliOutput;
    const client = new ClaudeCodeStepClient(clientOptions);

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

  executeStep(ctx: any, aggressiveness: any, accum: any) {
    return this.inner.executeStep(ctx, aggressiveness, accum);
  }

  reconstructGraph(feature: any, stepCache: any, questionAnswers?: any, repoSpec?: any) {
    return this.inner.reconstructGraph(feature, stepCache, questionAnswers, repoSpec);
  }
}

interface ClaudeCodeStepClientOptions {
  model: string;
  cwd: string;
  binaryPath?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  useShell?: boolean;
  onCliOutput?: ((data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void) | undefined;
}

class ClaudeCodeStepClient implements AnthropicLike {
  readonly messages: AnthropicLike["messages"];
  private readonly model: string;
  private readonly cwd: string;
  private readonly binaryPath: string;
  private readonly timeoutMs: number;
  private readonly spawnFn: SpawnFn;
  private readonly useShell: boolean;
  private readonly onCliOutput?: ((data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void) | undefined;

  constructor(options: ClaudeCodeStepClientOptions) {
    this.model = options.model;
    this.cwd = options.cwd;
    this.binaryPath = options.binaryPath ?? process.env.MANYHANDS_CLAUDE_BIN ?? "claude";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnFn = options.spawn ?? spawn;
    this.useShell = options.useShell ?? process.platform === "win32";
    this.onCliOutput = options.onCliOutput;
    this.messages = {
      create: async (args: any) => {
        // The instructions MUST travel through the CLI's real system-prompt
        // channel. A fake "## System" block embedded in the user turn reads as
        // prompt injection to Claude Code 2.1.x and it refuses to answer
        // ("This message contains what looks like an injected fake System
        // block…"), which surfaced as every planning step failing missing_json.
        const systemPrompt = [
          "CRITICAL: Do NOT call any tools. Do not search for files, do not read files, do not run grep, and do not execute any commands. All required context is fully provided in the prompt text.",
          "Analyze the input text locally and respond with strictly the JSON matching the schema — no prose, no plan file, no agents.",
          args.system
        ].join("\n\n");
        const prompt = args.messages.map((message: any) => message.content).join("\n\n");
        const text = await this.runClaude(prompt, systemPrompt, args.nodeId);
        return { content: [{ type: "text", text }] };
      }
    };
  }

  private async runClaude(prompt: string, systemPrompt: string, nodeId?: string): Promise<string> {
    // The system prompt travels as a temp FILE, not an inline arg: on Windows
    // the CLI shim needs shell:true, where a multi-line arg would be
    // concatenated unescaped into the command line.
    const systemPromptDir = await mkdtemp(path.join(os.tmpdir(), "mh-plan-system-"));
    const systemPromptPath = path.join(systemPromptDir, "system-prompt.md");
    await writeFile(systemPromptPath, systemPrompt, "utf8");
    const args = [
      "-p",
      STDIN_DIRECTIVE,
      "--model",
      this.model,
      "--output-format",
      "json",
      "--permission-mode",
      "plan",
      "--append-system-prompt-file",
      this.useShell ? `"${systemPromptPath}"` : systemPromptPath
    ];

    let outcome;
    try {
      outcome = await spawnClaude({
        binaryPath: this.binaryPath,
        args,
        cwd: this.cwd,
        prompt,
        timeoutMs: this.timeoutMs,
        spawnFn: this.spawnFn,
        useShell: this.useShell,
        onChunk: (chunk, stream) => {
          if (this.onCliOutput !== undefined && nodeId !== undefined) {
            this.onCliOutput({ nodeId, chunk, stream });
          }
        }
      });
    } finally {
      await rm(systemPromptDir, { recursive: true, force: true }).catch(() => undefined);
    }

    if (outcome.timedOut) {
      const message = `Claude Code recursive planning timed out after ${this.timeoutMs}ms`;
      throw new DecomposerLlmError(message, undefined, "request", {
        kind: "provider_timeout",
        stage: "request",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }
    if (outcome.exitCode !== 0) {
      const message = `Claude Code recursive planning failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`;
      throw new DecomposerLlmError(message, undefined, "request", {
        kind: "provider_request",
        stage: "request",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }

    const cliJson = parseJsonObject(outcome.stdout, { prefer: isClaudeResultEnvelope });
    if ("ok" in cliJson) {
      const message = `${cliJson.message} in Claude Code stdout for node "${nodeId ?? "?"}"`;
      throw new DecomposerLlmError(`${message}. Raw output was:\n${outcome.stdout}`, undefined, "parse", {
        kind: cliJson.kind,
        stage: "parse",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }

    const parsedCli = cliJson.value;
    if (isRecord(parsedCli) && parsedCli.type === "result" && typeof parsedCli.result === "string") {
      if (parsedCli.is_error === true) {
        const message = `Claude Code reported an error result for node "${nodeId ?? "?"}": ${parsedCli.result}`;
        throw new DecomposerLlmError(message, undefined, "request", {
          kind: "provider_request",
          stage: "request",
          recoverable: true,
          ...(nodeId !== undefined ? { nodeId } : {}),
          message
        });
      }
      return parsedCli.result;
    }

    const message = `Claude Code JSON output for node "${nodeId ?? "?"}" did not contain a result field`;
    throw new DecomposerLlmError(`${message}. Raw output was:\n${outcome.stdout}`, undefined, "parse", {
      kind: "schema_invalid",
      stage: "parse",
      recoverable: true,
      ...(nodeId !== undefined ? { nodeId } : {}),
      message
    });
  }
}

function isClaudeResultEnvelope(value: unknown): boolean {
  return isRecord(value) && value.type === "result" && typeof value.result === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface SpawnClaudeInput {
  binaryPath: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  spawnFn: SpawnFn;
  useShell: boolean;
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
}

interface SpawnClaudeOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function spawnClaude(input: SpawnClaudeInput): Promise<SpawnClaudeOutcome> {
  return new Promise((resolve) => {
    const child = input.spawnFn(input.binaryPath, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: input.useShell
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (outcome: SpawnClaudeOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: TIMEOUT_EXIT_CODE, stdout, stderr, timedOut: true });
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
      finish({
        exitCode: SPAWN_FAILURE_EXIT_CODE,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + error.message,
        timedOut: false
      });
    });
    child.on("close", (code) => {
      finish({ exitCode: code ?? SPAWN_FAILURE_EXIT_CODE, stdout, stderr, timedOut: false });
    });

    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.prompt);
  });
}
