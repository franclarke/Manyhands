import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

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

export interface GeminiRecursiveDecomposerOptions {
  model: string;
  userPrompt: string;
  cwd: string;
  binaryPath?: string;
  timeoutMs?: number;
  workspaceHints?: string;
  aggressiveness?: Aggressiveness;
  depthBudget?: number;
  maxParallelSteps?: number;
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
 * Short directive passed via `-p`. Gemini CLI only enters non-interactive
 * (headless) mode when `--prompt` has a non-empty value; that value is appended
 * to stdin. We feed the full planning prompt over stdin and use this as the
 * trigger. Verified against gemini-cli 0.44.1.
 */
const STDIN_DIRECTIVE = "Follow-planning-instructions-on-stdin";

/**
 * Recursive decomposer backed by the local Gemini CLI, not a hosted LLM API.
 * The RecursiveDecomposer owns recursion, validation and retries; this adapter
 * only supplies one step client backed by Gemini CLI in read-only plan mode.
 */
export class GeminiRecursiveDecomposer implements Decomposer {
  private readonly inner: RecursiveDecomposer;
  public readonly model: string;
  public readonly promptTemplateVersion: string;

  constructor(options: GeminiRecursiveDecomposerOptions) {
    this.model = options.model;
    this.promptTemplateVersion =
      options.promptTemplateVersion ?? `${RECURSIVE_DECOMPOSER_PROMPT_VERSION}.gemini`;

    const clientOptions: GeminiStepClientOptions = {
      model: options.model,
      cwd: options.cwd
    };
    if (options.binaryPath !== undefined) clientOptions.binaryPath = options.binaryPath;
    if (options.timeoutMs !== undefined) clientOptions.timeoutMs = options.timeoutMs;
    if (options.spawn !== undefined) clientOptions.spawn = options.spawn;
    if (options.useShell !== undefined) clientOptions.useShell = options.useShell;
    if (options.onCliOutput !== undefined) clientOptions.onCliOutput = options.onCliOutput;
    const client = new GeminiStepClient(clientOptions);

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
}

interface GeminiStepClientOptions {
  model: string;
  cwd: string;
  binaryPath?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  useShell?: boolean;
  onCliOutput?: ((data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void) | undefined;
}

class GeminiStepClient implements AnthropicLike {
  readonly messages: AnthropicLike["messages"];
  private readonly model: string;
  private readonly cwd: string;
  private readonly binaryPath: string;
  private readonly timeoutMs: number;
  private readonly spawnFn: SpawnFn;
  private readonly useShell: boolean;
  private readonly onCliOutput?: ((data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void) | undefined;

  constructor(options: GeminiStepClientOptions) {
    this.model = options.model;
    this.cwd = options.cwd;
    this.binaryPath = options.binaryPath ?? process.env.MANYHANDS_GEMINI_BIN ?? "gemini";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnFn = options.spawn ?? spawn;
    this.useShell = options.useShell ?? process.platform === "win32";
    this.onCliOutput = options.onCliOutput;
    this.messages = {
      create: async (args: any) => {
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
          args.messages.map((message: any) => message.content).join("\n\n")
        ].join("\n");
        const text = await this.runGemini(prompt, args.nodeId);
        return { content: [{ type: "text", text }] };
      }
    };
  }

  private async runGemini(prompt: string, nodeId?: string): Promise<string> {
    const args = [
      "--model",
      this.model,
      "--approval-mode",
      "plan",
      "--skip-trust",
      "-o",
      "json",
      "-p",
      STDIN_DIRECTIVE
    ];

    console.log(`[Gemini CLI] Spawning: ${this.binaryPath} ${args.join(" ")} (nodeId: ${nodeId ?? "unknown"})`);
    const start = Date.now();
    const outcome = await spawnGemini({
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
    const elapsed = Date.now() - start;

    if (outcome.timedOut) {
      const message = `Gemini recursive planning timed out after ${this.timeoutMs}ms`;
      console.error(`[Gemini CLI] Timeout after ${this.timeoutMs}ms for node "${nodeId ?? "unknown"}"`);
      throw new DecomposerLlmError(message, undefined, "request", {
        kind: "provider_timeout",
        stage: "request",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }
    if (outcome.exitCode !== 0) {
      const message = `Gemini recursive planning failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`;
      console.error(
        `[Gemini CLI] Failed with code ${outcome.exitCode} for node "${nodeId ?? "unknown"}". ` +
          `Stderr:\n${outcome.stderr || "(empty stderr)"}\nStdout:\n${outcome.stdout || "(empty stdout)"}`
      );
      throw new DecomposerLlmError(message, undefined, "request", {
        kind: "provider_request",
        stage: "request",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }

    console.log(`[Gemini CLI] Completed node "${nodeId ?? "unknown"}" in ${elapsed}ms`);

    const cliJson = parseJsonObject(outcome.stdout, { prefer: isGeminiCliPayload });
    if ("ok" in cliJson) {
      const message = `${cliJson.message} in Gemini CLI stdout for node "${nodeId ?? "?"}"`;
      console.error(`[Gemini CLI] ${message}. Raw output:\n${outcome.stdout}`);
      throw new DecomposerLlmError(`${message}. Raw output was:\n${outcome.stdout}`, undefined, "parse", {
        kind: cliJson.kind,
        stage: "parse",
        recoverable: true,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message
      });
    }

    const parsedCli = cliJson.value;
    if (isRecord(parsedCli) && typeof parsedCli.response === "string") {
      return parsedCli.response;
    }
    if (isRecord(parsedCli) && parsedCli.decision !== undefined) {
      return cliJson.raw;
    }

    const message = `Gemini CLI JSON output for node "${nodeId ?? "?"}" did not contain a response or decision field`;
    console.error(`[Gemini CLI] ${message}. Parsed output:`, parsedCli);
    throw new DecomposerLlmError(`${message}. Raw output was:\n${outcome.stdout}`, undefined, "parse", {
      kind: "schema_invalid",
      stage: "parse",
      recoverable: true,
      ...(nodeId !== undefined ? { nodeId } : {}),
      message
    });
  }
}

function isGeminiCliPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.response === "string" || value.decision !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface SpawnGeminiInput {
  binaryPath: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  spawnFn: SpawnFn;
  useShell: boolean;
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
}

interface SpawnGeminiOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function spawnGemini(input: SpawnGeminiInput): Promise<SpawnGeminiOutcome> {
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

    const finish = (outcome: SpawnGeminiOutcome): void => {
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
