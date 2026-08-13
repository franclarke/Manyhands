import { z } from "zod";
import { canonicalJson, computeCanonicalDigest, type DigestHasher } from "./canonical-json.js";
import { CanonicalDigestSchema } from "./canonical-reference.js";
import { EffectKindSchema } from "./effect-protocol.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export const JsonValueSchema = z.custom<JsonValue>(isStrictJsonValue, {
  message: "value must contain only finite JSON data"
}).transform(cloneJsonValue);

export const JsonObjectSchema = z.custom<JsonObject>(isStrictJsonObject, {
  message: "value must be a plain JSON object containing only finite JSON data"
}).transform((value) => cloneJsonValue(value) as JsonObject);

const EffectInputSpecStructureSchema = z.object({
  schemaVersion: z.literal(1),
  kind: EffectKindSchema,
  payload: JsonObjectSchema
}).strict();

export const EffectInputSpecSchema = z.custom<JsonObject>(isStrictJsonObject, {
  message: "effect input spec must be a plain finite JSON object"
}).pipe(EffectInputSpecStructureSchema);

export type EffectInputSpec = z.infer<typeof EffectInputSpecSchema>;

/**
 * The digest addresses the canonical spec but is deliberately kept outside it.
 * This prevents an identity field from participating in its own identity.
 */
const EffectInputStructureSchema = z.object({
  inputDigest: CanonicalDigestSchema,
  spec: EffectInputSpecSchema
}).strict();

export const EffectInputSchema = z.custom<JsonObject>(isStrictJsonObject, {
  message: "effect input identity must be a plain finite JSON object"
}).pipe(EffectInputStructureSchema);

export type EffectInput = z.infer<typeof EffectInputSchema>;

export function buildEffectInput(input: unknown, hasher: DigestHasher): EffectInput {
  const spec = EffectInputSpecSchema.parse(input);
  return EffectInputSchema.parse({
    inputDigest: computeCanonicalDigest(spec, hasher),
    spec
  });
}

export type EffectInputIdentityIssueCode = "schema_invalid" | "input_digest_mismatch";

export interface EffectInputIdentityIssue {
  code: EffectInputIdentityIssueCode;
  message: string;
}

export interface EffectInputIdentityValidationResult {
  ok: boolean;
  issues: EffectInputIdentityIssue[];
}

export function validateEffectInputIdentity(
  input: unknown,
  hasher: DigestHasher
): EffectInputIdentityValidationResult {
  const parsed = EffectInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        message: `${issue.path.join(".")}: ${issue.message}`
      }))
    };
  }

  if (computeCanonicalDigest(parsed.data.spec, hasher) !== parsed.data.inputDigest) {
    return {
      ok: false,
      issues: [{
        code: "input_digest_mismatch",
        message: "inputDigest does not identify the exact canonical effect input spec"
      }]
    };
  }

  return { ok: true, issues: [] };
}

function isStrictJsonObject(value: unknown): value is JsonObject {
  return isStrictJsonValue(value) && !Array.isArray(value) && value !== null;
}

function isStrictJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length !== value.length + 1 || !propertyNames.includes("length")) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return false;
    }
  } else {
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    for (const propertyName of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return false;
    }
  }

  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.every((item) => isStrictJsonValue(item, ancestors));
    }
    return Object.values(value).every((item) => isStrictJsonValue(item, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
