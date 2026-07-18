import type { DecomposeStepOutput } from "./recursive/step-schema";

export type GraphGenerationErrorKind =
  | "provider_timeout"
  | "provider_request"
  | "empty_response"
  | "missing_json"
  | "invalid_json"
  | "schema_invalid"
  | "duplicate_node_id"
  | "dangling_dependency"
  | "cycle_detected"
  | "graph_invalid"
  | "unknown";

export type DecomposerLlmStage = "request" | "parse" | "validate" | "normalize";

export interface GraphGenerationErrorDetails {
  kind: GraphGenerationErrorKind;
  stage: DecomposerLlmStage;
  recoverable: boolean;
  nodeId?: string | undefined;
  parentId?: string | null | undefined;
  attempt?: number | undefined;
  maxAttempts?: number | undefined;
  durationMs?: number | undefined;
  message: string;
  originalMessage?: string | undefined;
  /** First chars of the raw model text when parsing failed — the only evidence
   *  of WHY (prose, refusal, truncation) available to the operator. */
  responseExcerpt?: string | undefined;
}

export interface GraphGenerationErrorContext {
  nodeId?: string | undefined;
  parentId?: string | null | undefined;
  attempt?: number | undefined;
  maxAttempts?: number | undefined;
  durationMs?: number | undefined;
  stage?: DecomposerLlmStage | undefined;
}

/**
 * Typed error for LLM decomposer failures. The web layer persists the message,
 * while `details` carries node/attempt diagnostics for logs and planning traces.
 */
export class DecomposerLlmError extends Error {
  public readonly llmCause: unknown;
  public readonly stage?: DecomposerLlmStage;
  public readonly details?: GraphGenerationErrorDetails;
  /**
   * Resumable decomposer state at the moment this node's attempts were
   * exhausted. Populated by the recursive decomposer (from its in-flight
   * accumulator) right before throwing, so a retry can pick up the already-
   * generated siblings instead of restarting the whole tree from root.
   */
  public stepCache?: Record<string, DecomposeStepOutput>;

  constructor(
    message: string,
    cause?: unknown,
    stage?: DecomposerLlmStage,
    details?: GraphGenerationErrorDetails
  ) {
    super(message);
    this.name = "DecomposerLlmError";
    this.llmCause = cause;
    if (stage !== undefined) {
      this.stage = stage;
    }
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function isDecomposerLlmError(value: unknown): value is DecomposerLlmError {
  return value instanceof DecomposerLlmError;
}

export function classifyGraphGenerationError(
  value: unknown,
  context: GraphGenerationErrorContext = {}
): GraphGenerationErrorDetails {
  const base = value instanceof DecomposerLlmError ? value.details : undefined;
  const originalMessage =
    value instanceof Error ? value.message : value === undefined ? "Unknown error" : String(value);
  const kind = base?.kind ?? inferErrorKind(originalMessage);
  const stage = context.stage ?? base?.stage ?? inferStage(kind, value);

  return {
    kind,
    stage,
    recoverable: base?.recoverable ?? isRecoverableGraphGenerationKind(kind),
    message: base?.message ?? originalMessage,
    originalMessage,
    ...(context.nodeId !== undefined ? { nodeId: context.nodeId } : base?.nodeId !== undefined ? { nodeId: base.nodeId } : {}),
    ...(context.parentId !== undefined
      ? { parentId: context.parentId }
      : base?.parentId !== undefined
        ? { parentId: base.parentId }
        : {}),
    ...(context.attempt !== undefined ? { attempt: context.attempt } : base?.attempt !== undefined ? { attempt: base.attempt } : {}),
    ...(context.maxAttempts !== undefined
      ? { maxAttempts: context.maxAttempts }
      : base?.maxAttempts !== undefined
        ? { maxAttempts: base.maxAttempts }
        : {}),
    ...(context.durationMs !== undefined
      ? { durationMs: context.durationMs }
      : base?.durationMs !== undefined
        ? { durationMs: base.durationMs }
        : {}),
    ...(base?.responseExcerpt !== undefined ? { responseExcerpt: base.responseExcerpt } : {})
  };
}

export function isRecoverableGraphGenerationKind(kind: GraphGenerationErrorKind): boolean {
  switch (kind) {
    case "provider_timeout":
    case "provider_request":
    case "empty_response":
    case "missing_json":
    case "invalid_json":
    case "schema_invalid":
    case "duplicate_node_id":
    case "dangling_dependency":
    case "cycle_detected":
    case "graph_invalid":
      return true;
    case "unknown":
      return false;
  }
}

export class DecomposerQuestionError extends Error {
  public readonly nodeId: string;
  public readonly question: string;
  public readonly options: string[];
  public readonly stepCache: Record<string, DecomposeStepOutput>;
  public readonly reasoning?: string | undefined;

  constructor(
    nodeId: string,
    question: string,
    options: string[],
    stepCache: Record<string, DecomposeStepOutput>,
    reasoning?: string | undefined
  ) {
    super(`Clarification needed for node ${nodeId}: ${question}`);
    this.name = "DecomposerQuestionError";
    this.nodeId = nodeId;
    this.question = question;
    this.options = options;
    this.stepCache = stepCache;
    this.reasoning = reasoning;
  }
}

export function isDecomposerQuestionError(value: unknown): value is DecomposerQuestionError {
  return value instanceof DecomposerQuestionError;
}

function inferStage(kind: GraphGenerationErrorKind, value: unknown): DecomposerLlmStage {
  if (value instanceof DecomposerLlmError && value.stage !== undefined) {
    return value.stage;
  }
  switch (kind) {
    case "provider_timeout":
    case "provider_request":
      return "request";
    case "empty_response":
    case "missing_json":
    case "invalid_json":
      return "parse";
    case "schema_invalid":
    case "duplicate_node_id":
    case "dangling_dependency":
    case "cycle_detected":
      return "validate";
    case "graph_invalid":
      return "normalize";
    case "unknown":
      return "request";
  }
}

function inferErrorKind(message: string): GraphGenerationErrorKind {
  const normalized = message.toLowerCase();
  if (normalized.includes("timed out") || normalized.includes("timeout")) {
    return "provider_timeout";
  }
  if (normalized.includes("empty response") || normalized.includes("contained no text")) {
    return "empty_response";
  }
  if (normalized.includes("no json") || normalized.includes("could not locate a json")) {
    return "missing_json";
  }
  if (normalized.includes("json.parse") || normalized.includes("invalid json") || normalized.includes("parse json")) {
    return "invalid_json";
  }
  if (normalized.includes("schema validation") || normalized.includes("schema invalid")) {
    return "schema_invalid";
  }
  if (normalized.includes("duplicate node id") || normalized.includes("duplicate child id")) {
    return "duplicate_node_id";
  }
  if (normalized.includes("unknown") && normalized.includes("depend")) {
    return "dangling_dependency";
  }
  if (normalized.includes("cycle")) {
    return "cycle_detected";
  }
  if (normalized.includes("invalid graph") || normalized.includes("graph generation failed")) {
    return "graph_invalid";
  }
  if (
    normalized.includes("request failed") ||
    normalized.includes("exit code") ||
    normalized.includes("network") ||
    normalized.includes("econnreset") ||
    normalized.includes("socket hang up") ||
    normalized.includes("rate limit") ||
    normalized.includes("429") ||
    normalized.includes("503")
  ) {
    return "provider_request";
  }
  return "unknown";
}
