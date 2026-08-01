/**
 * Model pricing in USD per 1,000,000 tokens. The Gemini CLI reports token
 * counts but never a dollar cost, so we derive `costUsd = tokens × rate` here.
 * That single computation feeds the receipt, the run metrics, and the existing
 * budget guard (which never engaged for Gemini because cost stayed undefined).
 *
 * Rates are approximate public list prices (standard context tier) and are
 * intentionally centralised so they can be tuned in one place. Unknown models
 * return `undefined` rather than a fabricated zero.
 */
export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

/** Keyed by the model id the executor reports (sonnet/opus/haiku, gpt-5-*, …). */
export const MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  // Claude Code CLI reports short model ids.
  haiku: { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4 },
  sonnet: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  opus: { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  // Codex / GPT-5 family (execution-only today).
  "gpt-5-codex": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
  // OpenAI standard API pricing, refreshed for the G6 Codex CLI cell.
  "gpt-5.4-mini": { inputPerMillionUsd: 0.75, outputPerMillionUsd: 4.5 }
};

/** Looks up a price, tolerating provider-prefixed ids like "models/claude-sonnet". */
export function priceForModel(model: string): ModelPrice | undefined {
  if (model in MODEL_PRICING) return MODEL_PRICING[model];
  const tail = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : undefined;
  if (tail !== undefined && tail in MODEL_PRICING) return MODEL_PRICING[tail];
  return undefined;
}

/**
 * Dollar cost for a token split on a given model, or `undefined` when the model
 * has no known price (so callers can show "—" instead of a fake $0.00).
 */
export function costForModel(
  model: string,
  tokensIn: number,
  tokensOut: number
): number | undefined {
  const price = priceForModel(model);
  if (price === undefined) return undefined;
  return (
    (tokensIn / 1_000_000) * price.inputPerMillionUsd +
    (tokensOut / 1_000_000) * price.outputPerMillionUsd
  );
}

/**
 * Conservative cost for a provider that reports only a total token count.
 * The total may mix input and output, so charge every token at the higher
 * model rate instead of inventing an input/output split. This is an upper
 * bound suitable for enforcing a hard budget, not a claim about the exact
 * invoice amount.
 */
export function conservativeCostForTotalTokens(
  model: string,
  tokensTotal: number
): number | undefined {
  const price = priceForModel(model);
  if (price === undefined) return undefined;
  if (!Number.isInteger(tokensTotal) || tokensTotal < 0) return undefined;
  return (tokensTotal / 1_000_000) * Math.max(price.inputPerMillionUsd, price.outputPerMillionUsd);
}
