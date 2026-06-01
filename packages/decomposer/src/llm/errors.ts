/**
 * Error tipado para fallas del LLM decomposer. El web layer atrapa esto y
 * cae al fallback determinístico sin romper el canvas.
 */
export class DecomposerLlmError extends Error {
  public readonly llmCause: unknown;
  public readonly stage?: "request" | "parse" | "validate" | "normalize";

  constructor(
    message: string,
    cause?: unknown,
    stage?: "request" | "parse" | "validate" | "normalize"
  ) {
    super(message);
    this.name = "DecomposerLlmError";
    this.llmCause = cause;
    if (stage !== undefined) {
      this.stage = stage;
    }
  }
}

export function isDecomposerLlmError(value: unknown): value is DecomposerLlmError {
  return value instanceof DecomposerLlmError;
}

export class DecomposerQuestionError extends Error {
  public readonly nodeId: string;
  public readonly question: string;
  public readonly options: string[];
  public readonly stepCache: Record<string, any>;
  public readonly reasoning?: string;

  constructor(
    nodeId: string,
    question: string,
    options: string[],
    stepCache: Record<string, any>,
    reasoning?: string
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

