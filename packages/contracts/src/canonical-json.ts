export type DigestHasher = (canonicalJson: string) => string;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/**
 * JSON with recursively sorted object keys. Array order is deliberately
 * preserved: callers must normalize only the arrays their domain declares as
 * sets before computing identity.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

export function computeCanonicalDigest(value: unknown, hasher: DigestHasher): string {
  return hasher(canonicalJson(value));
}

export function verifyCanonicalDigest(
  value: Record<string, unknown>,
  digestField: string,
  hasher: DigestHasher
): boolean {
  const { [digestField]: claimedDigest, ...material } = value;
  return typeof claimedDigest === "string" && claimedDigest === computeCanonicalDigest(material, hasher);
}

export function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toCanonicalJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not support non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalJsonValue);
  if (typeof value !== "object") {
    throw new TypeError(`canonical JSON does not support ${typeof value}`);
  }

  const record = value as Record<string, unknown>;
  const canonical: Record<string, JsonValue> = {};
  for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
    const item = record[key];
    if (item === undefined) continue;
    canonical[key] = toCanonicalJsonValue(item);
  }
  return canonical;
}
