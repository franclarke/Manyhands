export interface JsonObjectCandidate {
  raw: string;
  start: number;
  end: number;
  index: number;
}

export interface ParsedJsonObjectCandidate extends JsonObjectCandidate {
  value: unknown;
}

export type ParseJsonObjectCandidatesResult =
  | {
      ok: true;
      candidates: ParsedJsonObjectCandidate[];
      invalidCandidateCount: number;
    }
  | {
      ok: false;
      kind: "empty_response" | "missing_json" | "invalid_json";
      message: string;
      invalidCandidateCount: number;
      parseErrors: string[];
    };

export type ParseJsonObjectResult =
  | ParsedJsonObjectCandidate
  | Extract<ParseJsonObjectCandidatesResult, { ok: false }>;

export function extractJson(text: string): string | null {
  const parsed = parseJsonObjectCandidates(text);
  return parsed.ok ? parsed.candidates[0]?.raw ?? null : null;
}

export function parseJsonObject(
  text: string,
  options: { prefer?: (value: unknown) => boolean } = {}
): ParseJsonObjectResult {
  const parsed = parseJsonObjectCandidates(text);
  if (!parsed.ok) {
    return parsed;
  }
  const preferred = options.prefer !== undefined
    ? parsed.candidates.find((candidate) => options.prefer?.(candidate.value) === true)
    : undefined;
  return preferred ?? parsed.candidates[0] ?? {
    ok: false,
    kind: "missing_json",
    message: "No JSON object found in response",
    invalidCandidateCount: parsed.invalidCandidateCount,
    parseErrors: []
  };
}

export function parseJsonObjectCandidates(text: string): ParseJsonObjectCandidatesResult {
  if (text.trim().length === 0) {
    return {
      ok: false,
      kind: "empty_response",
      message: "Model response was empty",
      invalidCandidateCount: 0,
      parseErrors: []
    };
  }

  const rawCandidates = extractJsonObjectCandidates(text);
  if (rawCandidates.length === 0) {
    return {
      ok: false,
      kind: "missing_json",
      message: "No JSON object found in response",
      invalidCandidateCount: 0,
      parseErrors: []
    };
  }

  const candidates: ParsedJsonObjectCandidate[] = [];
  const parseErrors: string[] = [];
  for (const candidate of rawCandidates) {
    try {
      candidates.push({ ...candidate, value: JSON.parse(candidate.raw) });
    } catch (error) {
      parseErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      kind: "invalid_json",
      message: `Found ${rawCandidates.length} JSON-like object(s), but none parsed as valid JSON`,
      invalidCandidateCount: rawCandidates.length,
      parseErrors
    };
  }

  return {
    ok: true,
    candidates,
    invalidCandidateCount: rawCandidates.length - candidates.length
  };
}

function extractJsonObjectCandidates(text: string): JsonObjectCandidate[] {
  const candidates: JsonObjectCandidate[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (ch !== "}") {
      continue;
    }

    if (depth === 0) {
      continue;
    }
    depth -= 1;
    if (depth === 0 && start >= 0) {
      candidates.push({
        raw: text.slice(start, i + 1),
        start,
        end: i + 1,
        index: candidates.length
      });
      start = -1;
    }
  }

  return candidates;
}
