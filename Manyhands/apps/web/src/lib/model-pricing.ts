/**
 * Client-safe model pricing for the UI (rate display + pre-run estimate).
 *
 * The backend computes real `costUsd` in `@manyhands/execution-core`
 * (`pricing.ts`); that package pulls node-only deps, so it cannot be imported
 * into a client bundle. This table mirrors the same rates — keep the two in
 * sync. Rates are USD per 1,000,000 tokens (approximate public list prices).
 */
export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export const MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  "gemini-2.5-pro": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
  "gemini-2.5-flash": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  sonnet: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  opus: { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  "gpt-5-codex": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 }
};

export function priceForModel(model: string): ModelPrice | undefined {
  if (model in MODEL_PRICING) return MODEL_PRICING[model];
  const tail = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : undefined;
  if (tail !== undefined && tail in MODEL_PRICING) return MODEL_PRICING[tail];
  return undefined;
}

/** Compact rate label, e.g. "$1.25 / $10 por M tokens". */
export function formatRate(model: string): string | undefined {
  const price = priceForModel(model);
  if (price === undefined) return undefined;
  return `$${trim(price.inputPerMillionUsd)} / $${trim(price.outputPerMillionUsd)} por M tokens`;
}

/**
 * Very rough pre-run cost band. Tokens are unknowable before planning, so this
 * is an explicit heuristic: a fixed per-run token profile (planning + a handful
 * of leaf executions) scaled by how much the prompt asks for and how finely the
 * run will decompose. Always shown as an estimate, never a quote.
 */
export interface CostEstimate {
  lowUsd: number;
  highUsd: number;
}

const GRANULARITY_FANOUT: Readonly<Record<string, number>> = {
  baja: 0.7,
  automatica: 1,
  media: 1.1,
  alta: 1.6
};

export function estimateRunCostUsd(
  model: string,
  options: { promptChars: number; granularity: string }
): CostEstimate | undefined {
  const price = priceForModel(model);
  if (price === undefined) return undefined;

  // ~4 chars/token; the prompt is small next to the repo grounding + tool I/O,
  // so base token volumes dominate. These are deliberate, conservative guesses.
  const promptTokens = Math.ceil(options.promptChars / 4);
  const fanout = GRANULARITY_FANOUT[options.granularity] ?? 1;

  const baseInput = 40_000; // planning + grounding + a few leaf contexts
  const baseOutput = 8_000; // generated diffs + reasoning
  const inputTokens = (baseInput + promptTokens * 20) * fanout;
  const outputTokens = (baseOutput + promptTokens * 4) * fanout;

  const mid =
    (inputTokens / 1_000_000) * price.inputPerMillionUsd +
    (outputTokens / 1_000_000) * price.outputPerMillionUsd;

  return { lowUsd: mid * 0.5, highUsd: mid * 2 };
}

/** Money formatting that never shows a misleading "$0.00" for tiny non-zero costs. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
