import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Decomposer, DecompositionOptions, DecompositionResult, FeatureRequest } from "../../index";
import type { AnthropicLike } from "../anthropic-decomposer";
import { DecomposerLlmError } from "../errors";
import {
  RecursiveDecomposer,
  type RecursiveDecomposerOptions,
  type RecursiveStepCompletedEvent,
  type RecursiveStepListener,
  type RecursiveStepStartedEvent
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
  binaryPath?: string;
  timeoutMs?: number;
  reasoningEffort?: string;
  workspaceHints?: string;
  aggressiveness?: Aggressiveness;
  depthBudget?: number;
  promptTemplateVersion?: string;
  onStepStarted?: RecursiveStepListener<RecursiveStepStartedEvent>;
  onStepCompleted?: RecursiveStepListener<RecursiveStepCompletedEvent>;
  spawn?: SpawnFn;
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
  tmpDir?: string;
  useShell?: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_REASONING_EFFORT = "low";
const SPAWN_FAILURE_EXIT_CODE = 127;
const TIMEOUT_EXIT_CODE = 124;

/**
 * Recursive decomposer backed by local `codex exec`, not a hosted LLM API.
 *
 * The existing RecursiveDecomposer already owns the graph-building recursion,
 * validation, and interface wiring. This adapter only replaces its step client:
 * each "is this node atomic?" decision is delegated to Codex CLI with
 * `--sandbox read-only`, `--ephemeral`, and an output schema.
 */
export class CodexRecursiveDecomposer implements Decomposer {
  private readonly inner: RecursiveDecomposer;
  public readonly model: string;
  public readonly promptTemplateVersion: string;

  constructor(options: CodexRecursiveDecomposerOptions) {
    this.model = options.model;
    this.promptTemplateVersion =
      options.promptTemplateVersion ?? `${RECURSIVE_DECOMPOSER_PROMPT_VERSION}.codex`;

    const clientOptions: CodexStepClientOptions = {
      model: options.model,
      cwd: options.cwd
    };
    if (options.binaryPath !== undefined) clientOptions.binaryPath = options.binaryPath;
    if (options.timeoutMs !== undefined) clientOptions.timeoutMs = options.timeoutMs;
    if (options.reasoningEffort !== undefined) clientOptions.reasoningEffort = options.reasoningEffort;
    if (options.spawn !== undefined) clientOptions.spawn = options.spawn;
    if (options.readFile !== undefined) clientOptions.readFile = options.readFile;
    if (options.writeFile !== undefined) clientOptions.writeFile = options.writeFile;
    if (options.tmpDir !== undefined) clientOptions.tmpDir = options.tmpDir;
    if (options.useShell !== undefined) clientOptions.useShell = options.useShell;
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
    if (options.onStepStarted !== undefined) recursiveOptions.onStepStarted = options.onStepStarted;
    if (options.onStepCompleted !== undefined) recursiveOptions.onStepCompleted = options.onStepCompleted;
    this.inner = new RecursiveDecomposer(recursiveOptions);
  }

  decompose(input: FeatureRequest, options?: DecompositionOptions): Promise<DecompositionResult> {
    return this.inner.decompose(input, options);
  }
}

interface CodexStepClientOptions {
  model: string;
  cwd: string;
  binaryPath?: string;
  timeoutMs?: number;
  reasoningEffort?: string;
  spawn?: SpawnFn;
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
  tmpDir?: string;
  useShell?: boolean;
}

class CodexStepClient implements AnthropicLike {
  readonly messages: AnthropicLike["messages"];
  private readonly model: string;
  private readonly cwd: string;
  private readonly binaryPath: string;
  private readonly timeoutMs: number;
  private readonly reasoningEffort: string;
  private readonly spawnFn: SpawnFn;
  private readonly readFileFn: (filePath: string) => Promise<string>;
  private readonly writeFileFn: (filePath: string, content: string) => Promise<void>;
  private readonly tmpDir: string;
  private readonly useShell: boolean;

  constructor(options: CodexStepClientOptions) {
    this.model = options.model;
    this.cwd = options.cwd;
    this.binaryPath = options.binaryPath ?? process.env.MANYHANDS_CODEX_BIN ?? "codex";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.reasoningEffort = resolveReasoningEffort(options.reasoningEffort);
    this.spawnFn = options.spawn ?? spawn;
    this.readFileFn = options.readFile ?? ((filePath) => readFile(filePath, "utf8"));
    this.writeFileFn = options.writeFile ?? ((filePath, content) => writeFile(filePath, content, "utf8"));
    this.tmpDir = options.tmpDir ?? tmpdir();
    this.useShell = options.useShell ?? process.platform === "win32";
    this.messages = {
      create: async (args) => {
        const prompt = [
          "## System",
          args.system,
          "",
          "## User",
          args.messages.map((message) => message.content).join("\n\n")
        ].join("\n");
        const text = await this.runCodex(prompt);
        return { content: [{ type: "text", text }] };
      }
    };
  }

  private async runCodex(prompt: string): Promise<string> {
    const outputPath = join(this.tmpDir, `manyhands-codex-step-${process.pid}-${Date.now()}.json`);

    // --output-schema is intentionally omitted: the OpenAI API rejects oneOf at the root
    // of a response_format schema, which breaks ChatGPT-account Codex sessions. The prompt
    // already specifies the exact JSON shape; DecomposeStepOutputSchema.safeParse validates
    // the parsed output application-side.
    const args = [
      "exec",
      "--sandbox",
      "read-only",
      "--model",
      this.model,
      "--ephemeral",
      "-C",
      this.cwd,
      "--output-last-message",
      outputPath
    ];
    if (this.reasoningEffort.length > 0) {
      // Planning is a structured local decision, not implementation. Keep it fast
      // unless a benchmark explicitly overrides the effort.
      args.push("-c", `model_reasoning_effort=${this.reasoningEffort}`);
    }

    const outcome = await spawnCodex({
      binaryPath: this.binaryPath,
      args,
      cwd: this.cwd,
      prompt,
      timeoutMs: this.timeoutMs,
      spawnFn: this.spawnFn,
      useShell: this.useShell
    });

    if (outcome.timedOut) {
      throw new DecomposerLlmError(
        `Codex recursive planning timed out after ${this.timeoutMs}ms`,
        undefined,
        "request"
      );
    }
    if (outcome.exitCode !== 0) {
      throw new DecomposerLlmError(
        `Codex recursive planning failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`,
        undefined,
        "request"
      );
    }

    try {
      const last = await this.readFileFn(outputPath);
      if (last.trim().length > 0) return last.trim();
    } catch {
      // Older/fake Codex runners may only return stdout; fall through.
    }
    return outcome.stdout.trim();
  }
}

interface SpawnCodexInput {
  binaryPath: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  spawnFn: SpawnFn;
  useShell: boolean;
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
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: input.useShell
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (outcome: SpawnCodexOutcome): void => {
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
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
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

function resolveReasoningEffort(override: string | undefined): string {
  return (
    override ??
    process.env.MANYHANDS_CODEX_PLANNING_REASONING ??
    process.env.MANYHANDS_CODEX_REASONING ??
    DEFAULT_REASONING_EFFORT
  ).trim();
}
