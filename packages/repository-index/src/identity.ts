import { createHash } from "node:crypto";

export function repositoryDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalizeRepositoryValue(value))).digest("hex")}`;
}

export function repositoryFactId(prefix: string, material: unknown): string {
  return `${prefix}:${repositoryDigest(material).slice("sha256:".length, "sha256:".length + 24)}`;
}

export function canonicalizeRepositoryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeRepositoryValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeRepositoryValue(item)])
    );
  }
  return value;
}
