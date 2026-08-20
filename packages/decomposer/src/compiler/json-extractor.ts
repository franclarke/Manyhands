/**
 * Multi-stage robust JSON extractor for LLM-generated output.
 * Handles markdown fences, <thinking> tags, conversational preamble/postamble,
 * and minor syntax flaws like trailing commas.
 */

/**
 * Strips `<thinking>` or `<thought>` blocks commonly emitted by reasoning models.
 */
export function stripThinkingBlocks(text: string): string {
  return text
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thought[\s\S]*?<\/thought>/gi, "")
    .trim();
}

/**
 * Extracts the content inside the first markdown code fence (```json ... ``` or ``` ... ```).
 * If no code fence exists, returns the original text.
 */
export function extractMarkdownFence(text: string): string {
  const fenced = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/u.exec(text);
  return fenced !== null ? fenced[1]!.trim() : text.trim();
}

/**
 * Normalizes minor, common LLM syntax issues like trailing commas before closing braces/brackets.
 */
export function repairCommonJsonSyntax(input: string): string {
  let cleaned = input;
  // Remove trailing commas in objects: `, \s* }` -> `}`
  cleaned = cleaned.replace(/,\s*}/g, "}");
  // Remove trailing commas in arrays: `, \s* ]` -> `]`
  cleaned = cleaned.replace(/,\s*]/g, "]");
  return cleaned;
}

/**
 * Scans a string to find the outermost balanced `{ ... }` candidate.
 * Handles strings, escaped quotes, and nested braces properly.
 */
export function extractBalancedJsonObject(text: string): string | undefined {
  const cleaned = stripThinkingBlocks(text);
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let startIndex = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      if (inString) escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      if (depth === 0) {
        startIndex = i;
      }
      depth++;
    } else if (char === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && startIndex !== -1) {
          const candidate = cleaned.slice(startIndex, i + 1);
          return candidate;
        }
      }
    }
  }

  return undefined;
}

/**
 * Robustly parses a JSON object from arbitrary LLM output.
 * Tries direct parsing, fence extraction, balanced scan, and syntax repair.
 */
export function robustlyParseJson(rawOutput: string): { ok: true; value: unknown } | { ok: false; raw: string } {
  if (typeof rawOutput !== "string" || rawOutput.trim().length === 0) {
    return { ok: false, raw: "" };
  }

  const cleaned = stripThinkingBlocks(rawOutput);

  // Strategy 1: Direct parse of stripped text
  try {
    const parsed = JSON.parse(cleaned);
    return { ok: true, value: parsed };
  } catch {
    // Continue to strategy 2
  }

  // Strategy 2: Extract inside markdown fence and parse
  const fenced = extractMarkdownFence(cleaned);
  if (fenced !== cleaned) {
    try {
      const parsed = JSON.parse(fenced);
      return { ok: true, value: parsed };
    } catch {
      // Continue to repair Strategy 2
      try {
        const repaired = repairCommonJsonSyntax(fenced);
        const parsed = JSON.parse(repaired);
        return { ok: true, value: parsed };
      } catch {
        // Continue
      }
    }
  }

  // Strategy 3: Find outermost balanced JSON object in the entire text
  const balanced = extractBalancedJsonObject(cleaned);
  if (balanced !== undefined) {
    try {
      const parsed = JSON.parse(balanced);
      return { ok: true, value: parsed };
    } catch {
      // Strategy 4: Apply syntax repairs to balanced candidate
      try {
        const repaired = repairCommonJsonSyntax(balanced);
        const parsed = JSON.parse(repaired);
        return { ok: true, value: parsed };
      } catch {
        // Fall through
      }
    }
  }

  // Strategy 5: Try syntax repair on the full text as a last resort
  try {
    const repaired = repairCommonJsonSyntax(cleaned);
    const parsed = JSON.parse(repaired);
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, raw: rawOutput };
  }
}
