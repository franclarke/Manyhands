import { NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { computeCanonicalDigest, sortedUniqueStrings, type DigestHasher } from "./canonical-json.js";
import { CanonicalDigestSchema } from "./canonical-reference.js";

export const InputFingerprintMaterialSchema = z.object({
  executionBase: z.object({
    repositoryViewDigest: CanonicalDigestSchema,
    treeSha: NonEmptyStringSchema
  }).strict(),
  consumedArtifactDigests: z.array(CanonicalDigestSchema).default([]),
  nodeContractDigest: CanonicalDigestSchema,
  resourceClaimDigest: CanonicalDigestSchema,
  contextDigest: CanonicalDigestSchema,
  executorProfileDigest: CanonicalDigestSchema,
  sandboxCapabilityDigest: CanonicalDigestSchema
}).strict();
export type InputFingerprintMaterial = z.infer<typeof InputFingerprintMaterialSchema>;

export const InputFingerprintSchema = CanonicalDigestSchema;
export type InputFingerprint = z.infer<typeof InputFingerprintSchema>;

export function buildInputFingerprint(input: InputFingerprintMaterial, hasher: DigestHasher): InputFingerprint {
  const parsed = InputFingerprintMaterialSchema.parse(input);
  return computeCanonicalDigest(normalizeInputFingerprintMaterial(parsed), hasher);
}

export interface InputFingerprintValidationResult {
  ok: boolean;
  issues: Array<{ code: "schema_invalid" | "fingerprint_digest_mismatch"; message: string }>;
}

export function validateInputFingerprint(
  input: unknown,
  fingerprint: unknown,
  hasher: DigestHasher
): InputFingerprintValidationResult {
  const material = InputFingerprintMaterialSchema.safeParse(input);
  const parsedFingerprint = InputFingerprintSchema.safeParse(fingerprint);
  if (!material.success || !parsedFingerprint.success) {
    return { ok: false, issues: [{ code: "schema_invalid", message: "fingerprint material or digest is invalid" }] };
  }
  const expected = computeCanonicalDigest(normalizeInputFingerprintMaterial(material.data), hasher);
  if (expected !== parsedFingerprint.data) {
    return {
      ok: false,
      issues: [{ code: "fingerprint_digest_mismatch", message: "InputFingerprint does not identify the exact canonical eligibility inputs" }]
    };
  }
  return { ok: true, issues: [] };
}

function normalizeInputFingerprintMaterial(material: InputFingerprintMaterial): InputFingerprintMaterial {
  return { ...material, consumedArtifactDigests: sortedUniqueStrings(material.consumedArtifactDigests) };
}
