import Anthropic from "@anthropic-ai/sdk";
import { DecomposerLlmError } from "./errors";
import { runDecomposerGuards } from "./guards";
import { normalizeLlmDecomposition } from "./normalize";
import { DecomposerLlmOutputSchema, type DecomposerLlmOutput } from "./output-schema";
import {
  DECOMPOSER_PROMPT_TEMPLATE_VERSION,
  buildDecomposerPrompt,
  type WorkspaceHints
} from "./prompt-template";
import {
  DecompositionOptionsSchema,
  FeatureRequestSchema,
  type Decomposer,
  type DecompositionMode,
  type DecompositionOptions,
  type DecompositionResult,
  type FeatureRequest
} from "../index";

export interface AnthropicDecomposerOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  workspaceHints?: WorkspaceHints;
  userPrompt: string;
  promptTemplateVersion?: string;
  /** Inject a custom client (used by tests). */
  client?: AnthropicLike;
}

/** Minimal interface so tests can mock the SDK without bringing in the full Anthropic type. */
export interface AnthropicLike {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }): Promise<{
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export interface AnthropicDecomposerResult {
  result: DecompositionResult;
  rawResponse: string;
  parsedOutput: DecomposerLlmOutput;
  usage?: { inputTokens: number; outputTokens: number };
  promptTemplateVersion: string;
}

export class AnthropicDecomposer implements Decomposer {
  private readonly client: AnthropicLike;
  public readonly model: string;
  public readonly maxTokens: number;
  public readonly promptTemplateVersion: string;
  private readonly userPrompt: string;
  private readonly workspaceHints?: WorkspaceHints;
  private lastResponse: AnthropicDecomposerResult | null = null;

  constructor(options: AnthropicDecomposerOptions) {
    this.client = options.client ?? (new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 60_000
    }) as unknown as AnthropicLike);
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 8000;
    this.promptTemplateVersion = options.promptTemplateVersion ?? DECOMPOSER_PROMPT_TEMPLATE_VERSION;
    this.userPrompt = options.userPrompt;
    if (options.workspaceHints !== undefined) {
      this.workspaceHints = options.workspaceHints;
    }
  }

  async decompose(input: FeatureRequest, options: DecompositionOptions = {}): Promise<DecompositionResult> {
    const feature = FeatureRequestSchema.parse(input);
    const parsedOptions = DecompositionOptionsSchema.parse(options);
    const mode: DecompositionMode = parsedOptions.mode;

    const { system, user } = buildDecomposerPrompt({
      userPrompt: this.userPrompt,
      granularity: mode,
      ...(this.workspaceHints !== undefined ? { workspaceHints: this.workspaceHints } : {})
    });

    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: [{ role: "user", content: user }]
      });
    } catch (error) {
      throw new DecomposerLlmError(
        `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
        "request"
      );
    }

    const text = extractText(response.content);
    if (text.length === 0) {
      throw new DecomposerLlmError("Anthropic response contained no text block", undefined, "parse");
    }

    const json = extractJson(text);
    if (json === null) {
      throw new DecomposerLlmError("Could not locate a JSON object in the model response", undefined, "parse");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new DecomposerLlmError(
        `Failed to JSON.parse model output: ${error instanceof Error ? error.message : String(error)}`,
        error,
        "parse"
      );
    }

    const schemaResult = DecomposerLlmOutputSchema.safeParse(parsed);
    if (!schemaResult.success) {
      const first = schemaResult.error.issues[0];
      throw new DecomposerLlmError(
        `Output schema validation failed: ${first?.path.join(".") ?? "?"} — ${first?.message ?? "unknown"}`,
        schemaResult.error,
        "validate"
      );
    }

    runDecomposerGuards(schemaResult.data, { granularity: mode });

    const generatedAt = parsedOptions.generatedAt ?? new Date().toISOString();
    const result = normalizeLlmDecomposition({
      feature,
      output: schemaResult.data,
      mode,
      generatedAt,
      decomposerLabel: `anthropic:${this.model}`,
      baseBranch: parsedOptions.baseBranch,
      baseCommit: parsedOptions.baseCommit,
      repo: parsedOptions.repo ?? feature.repositoryPath ?? "manyhands-workspace"
    });

    this.lastResponse = {
      result,
      rawResponse: capRawResponse(text),
      parsedOutput: schemaResult.data,
      promptTemplateVersion: this.promptTemplateVersion,
      ...(response.usage !== undefined
        ? { usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } }
        : {})
    };

    return result;
  }

  /** Returns the metadata captured during the most recent `decompose` call (for RunRecord persistence). */
  getLastResponse(): AnthropicDecomposerResult | null {
    return this.lastResponse;
  }
}

const MAX_RAW_RESPONSE_BYTES = 64 * 1024;

function capRawResponse(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_RAW_RESPONSE_BYTES) return text;
  return `${text.slice(0, MAX_RAW_RESPONSE_BYTES)}…[truncated]`;
}

function extractText(blocks: Array<{ type: string; text?: string }>): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

function extractJson(text: string): string | null {
  // Strict path: the whole text is JSON.
  if (text.startsWith("{") && text.endsWith("}")) return text;
  // Fallback: locate first balanced JSON object using a brace counter.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
