import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { z } from "zod";

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const DEFAULT_TIMEOUT_MS = 30_000;
const SPAWN_FAILURE_EXIT_CODE = 127;
const TIMEOUT_EXIT_CODE = 124;

/**
 * Short directive passed via `-p`/`--print`. Claude Code runs one headless turn
 * and emits a JSON result envelope; the real instructions go over stdin.
 */
const STDIN_DIRECTIVE = "Follow-titling-instructions-on-stdin";

export const RunTitleSchema = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(400)
});

export type RunTitle = z.infer<typeof RunTitleSchema>;

export class RunTitlerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RunTitlerError";
  }
}

export interface GenerateRunTitleInput {
  userPrompt: string;
  model: string;
  cwd?: string;
  binaryPath?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  useShell?: boolean;
  platform?: NodeJS.Platform;
}

/**
 * Turns a raw user prompt into a clean `{ title, summary }` using Claude Code in
 * read-only plan mode. Pure presentation concern — never touches the repo
 * and never participates in graph generation. Callers treat failures as
 * non-fatal (cosmetic fallback to the raw prompt).
 */
export async function generateRunTitle(input: GenerateRunTitleInput): Promise<RunTitle> {
  const binaryPath = input.binaryPath ?? process.env.MANYHANDS_CLAUDE_BIN ?? "claude";
  const spawnFn = input.spawn ?? nodeSpawn;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const platform = input.platform ?? process.platform;
  const useShell = input.useShell ?? platform === "win32";
  const cwd = input.cwd ?? process.cwd();

  const prompt = buildTitlerPrompt(input.userPrompt);
  const args = ["-p", STDIN_DIRECTIVE, "--model", input.model, "--output-format", "json", "--permission-mode", "plan"];

  const outcome = await runProcess({ binaryPath, args, cwd, prompt, timeoutMs, spawnFn, useShell, platform });

  if (outcome.timedOut) {
    throw new RunTitlerError(`Run titler timed out after ${timeoutMs}ms`);
  }
  if (outcome.exitCode !== 0) {
    throw new RunTitlerError(`Run titler failed with exit code ${outcome.exitCode}: ${outcome.stderr || outcome.stdout}`);
  }

  const candidate = extractTitleSummary(outcome.stdout);
  if (candidate === null) {
    throw new RunTitlerError(`Run titler produced no parseable JSON. Raw output:\n${outcome.stdout}`);
  }
  const parsed = RunTitleSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RunTitlerError(`Run titler output did not match schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}

function buildTitlerPrompt(userPrompt: string): string {
  return [
    "## System",
    "You write a short title and a clean one-paragraph summary for a software task.",
    "CRITICAL: Do NOT call any tools. Do not read files, do not run commands. Analyze only the text below.",
    'Respond with STRICTLY a JSON object and nothing else: {"title": string, "summary": string}.',
    "Rules:",
    "- title: at most 8 words, no quotes, no markdown, no trailing punctuation.",
    "- summary: 1-2 sentences describing what the task builds, in natural prose.",
    "- Write both in the SAME LANGUAGE as the task description below.",
    "",
    "## Task description",
    userPrompt
  ].join("\n");
}

interface ProcessOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(input: {
  binaryPath: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  spawnFn: SpawnFn;
  useShell: boolean;
  platform: NodeJS.Platform;
}): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const spawnCommand = resolveSpawnCommand(input);
    const child = input.spawnFn(spawnCommand.command, spawnCommand.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: spawnCommand.shell
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (outcome: ProcessOutcome): void => {
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
      finish({ exitCode: SPAWN_FAILURE_EXIT_CODE, stdout, stderr: stderr + (stderr ? "\n" : "") + error.message, timedOut: false });
    });
    child.on("close", (code) => {
      finish({ exitCode: code ?? SPAWN_FAILURE_EXIT_CODE, stdout, stderr, timedOut: false });
    });

    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.prompt);
  });
}

function resolveSpawnCommand(input: {
  binaryPath: string;
  args: string[];
  useShell: boolean;
  platform: NodeJS.Platform;
}): { command: string; args: string[]; shell: boolean } {
  if (input.useShell && input.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", input.binaryPath, ...input.args],
      shell: false
    };
  }
  return { command: input.binaryPath, args: input.args, shell: input.useShell };
}

/** First balanced `{...}` object in a string, or null. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extracts the `{ title, summary }` object from Claude Code stdout, tolerating
 * the `--output-format json` envelope (`{"type":"result","result":"<inner json
 * string>"}`) and direct JSON.
 */
function extractTitleSummary(stdout: string): unknown {
  const outer = firstJsonObject(stdout);
  if (outer === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(outer);
  } catch {
    return null;
  }
  if (parsed !== null && typeof parsed === "object" && "title" in parsed) {
    return parsed;
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    "result" in parsed &&
    typeof (parsed as { result: unknown }).result === "string"
  ) {
    const inner = firstJsonObject((parsed as { result: string }).result);
    if (inner === null) return null;
    try {
      return JSON.parse(inner);
    } catch {
      return null;
    }
  }
  return null;
}
