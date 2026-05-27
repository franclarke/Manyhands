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
