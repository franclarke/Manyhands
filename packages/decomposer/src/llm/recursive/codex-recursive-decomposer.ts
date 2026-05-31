import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Decomposer, DecompositionOptions, DecompositionResult, FeatureRequest } from "../../index";
import type { AnthropicLike } from "../anthropic-decomposer";
import { DecomposerLlmError } from "../errors";
import { RecursiveDecomposer, type RecursiveDecomposerOptions } from "./recursive-decomposer";
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
  workspaceHints?: string;
  aggressiveness?: Aggressiveness;
  depthBudget?: number;
  promptTemplateVersion?: string;
  spawn?: SpawnFn;
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
  tmpDir?: string;
  useShell?: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const SPAWN_FAILURE_EXIT_CODE = 127;
const TIMEOUT_EXIT_CODE = 124;
const OUTPUT_SCHEMA_FILE = "manyhands-recursive-step.schema.json";

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
    const schemaPath = join(this.tmpDir, OUTPUT_SCHEMA_FILE);
    const outputPath = join(this.tmpDir, `manyhands-codex-step-${process.pid}-${Date.now()}.json`);
    await this.writeFileFn(schemaPath, JSON.stringify(CODEX_STEP_JSON_SCHEMA, null, 2));

    const args = [
      "exec",
      "--sandbox",
      "read-only",
      "--model",
      this.model,
      "--ephemeral",
      "-C",
      this.cwd,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath
    ];

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

const CODEX_STEP_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  oneOf: [
    {
      additionalProperties: false,
      required: ["decision", "reasoning", "allowedPaths", "forbiddenPaths", "expectedFiles", "acceptanceCriteria"],
      properties: {
        decision: { const: "atomic" },
        reasoning: { type: "string", minLength: 1, maxLength: 800 },
        allowedPaths: { type: "array", maxItems: 60, items: { type: "string", minLength: 1 } },
        forbiddenPaths: { type: "array", maxItems: 60, items: { type: "string", minLength: 1 } },
        expectedFiles: { type: "array", maxItems: 60, items: { type: "string", minLength: 1 } },
        acceptanceCriteria: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: { type: "string", minLength: 1, maxLength: 400 }
        }
      }
    },
    {
      additionalProperties: false,
      required: ["decision", "reasoning", "sharedInterfaces", "children", "dependencies", "parentValidationCommands"],
      properties: {
        decision: { const: "decompose" },
        reasoning: { type: "string", minLength: 1, maxLength: 800 },
        sharedInterfaces: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "signature", "description"],
            properties: {
              id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*$", minLength: 1, maxLength: 80 },
              kind: { enum: ["type", "function", "module"] },
              signature: { type: "string", minLength: 1, maxLength: 2000 },
              description: { type: "string", minLength: 1, maxLength: 600 }
            }
          }
        },
        children: {
          type: "array",
          minItems: 2,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "title", "goal", "consumes", "produces"],
            properties: {
              id: { type: "string", pattern: "^[a-z][a-z0-9_-]*$", minLength: 1, maxLength: 80 },
              title: { type: "string", minLength: 1, maxLength: 160 },
              goal: { type: "string", minLength: 1, maxLength: 600 },
              kind: { enum: ["composite", "leaf"] },
              consumes: { type: "array", maxItems: 40, items: { type: "string", minLength: 1 } },
              produces: { type: "array", maxItems: 40, items: { type: "string", minLength: 1 } }
            }
          }
        },
        dependencies: {
          type: "array",
          maxItems: 60,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["fromTaskId", "toTaskId", "type"],
            properties: {
              fromTaskId: { type: "string", minLength: 1 },
              toTaskId: { type: "string", minLength: 1 },
              type: { enum: ["contractual", "structural", "logical"] },
              rationale: { type: "string", maxLength: 400 }
            }
          }
        },
        parentValidationCommands: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["command", "args"],
            properties: {
              command: { type: "string", minLength: 1, maxLength: 200 },
              args: { type: "array", maxItems: 40, items: { type: "string" } }
            }
          }
        }
      }
    }
  ]
};
