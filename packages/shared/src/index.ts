import { z } from "zod";
export * from "./executor-registry";
import { EFFORT_LEVELS } from "./executor-registry";

/**
 * Canonical zod schema for the reasoning-effort domain, sourced from the single
 * {@link EFFORT_LEVELS} tuple so backend schemas never re-list the values.
 */
export const ReasoningEffortSchema = z.enum(EFFORT_LEVELS);

export const NonEmptyStringSchema = z.string().trim().min(1);

export const EpistemicAssessmentSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unknown"), reason: NonEmptyStringSchema, evidenceRefs: z.tuple([]) }).strict(),
  z.object({
    state: z.enum(["known", "partial", "conflicting"]),
    confidence: z.enum(["high", "medium", "low"]),
    evidenceRefs: z.array(NonEmptyStringSchema).min(1)
  }).strict()
]);

export type EpistemicAssessment = z.infer<typeof EpistemicAssessmentSchema>;

export const EntityIdSchema = NonEmptyStringSchema.regex(
  /^[A-Za-z0-9._:-]+$/,
  "ids may contain letters, digits, dots, underscores, colons and hyphens"
);

export type EntityId = z.infer<typeof EntityIdSchema>;

/**
 * A reference to a repository resource: either a catalogued resource id or a
 * locator such as `path:src/domain`.
 *
 * Locators carry slashes, which `EntityIdSchema` rejects. A plan could name a
 * directory in `repositorySurface.resourceRefs`, typed as a plain string, but
 * not in the matching `resourceIntents[].resourceId` — so a unit could describe
 * the directory it works in and then had no way to claim it.
 */
export const ResourceReferenceSchema = NonEmptyStringSchema.regex(
  /^[A-Za-z0-9._:/-]+$/,
  "resource references may contain letters, digits, dots, underscores, colons, hyphens and slashes"
).refine(
  (value) => !value.split("/").includes(".."),
  "resource references may not contain a .. segment"
);

export type ResourceReference = z.infer<typeof ResourceReferenceSchema>;

export const GranularityPolicyManifestSchema = z.object({
  policyVersion: NonEmptyStringSchema,
  maxLeafContextTokens: z.number().int().nonnegative(),
  maxLeafScopePaths: z.number().int().positive(),
  maxLeafPlannedPaths: z.number().int().positive()
}).strict();

export type GranularityPolicyManifest = z.infer<typeof GranularityPolicyManifestSchema>;

export const FinalArtifactManifestSchema = z.object({
  commitSha: NonEmptyStringSchema,
  treeSha: NonEmptyStringSchema,
  graphRevision: z.number().int().nonnegative(),
  artifactIds: z.array(EntityIdSchema),
  evidenceMatrixId: EntityIdSchema,
  validationRecipeDigest: NonEmptyStringSchema,
  deliveryTarget: NonEmptyStringSchema,
  granularityPolicy: GranularityPolicyManifestSchema.optional()
}).strict();

export type FinalArtifactManifest = z.infer<typeof FinalArtifactManifestSchema>;

export const ValidationEvidenceKindSchema = z.enum([
  "static_analysis",
  "test_result",
  "runtime_observation",
  "artifact_inspection",
  "manual_attestation"
]);

/** One physical validation execution attributed to its explicitly linked criteria. */
export const CriterionEvidenceObservationSchema = z.object({
  evidenceId: EntityIdSchema,
  kind: ValidationEvidenceKindSchema,
  commandDigest: NonEmptyStringSchema.regex(/^[a-f0-9]{64}$/u),
  durationMs: z.number().nonnegative(),
  passed: z.boolean(),
  attempt: z.number().int().positive(),
  outputDigest: NonEmptyStringSchema.regex(/^[a-f0-9]{64}$/u),
  criterionIds: z.array(EntityIdSchema).min(1),
  obligationIds: z.array(EntityIdSchema).min(1),
  references: z.array(NonEmptyStringSchema).min(1)
}).strict();

export type CriterionEvidenceObservation = z.infer<typeof CriterionEvidenceObservationSchema>;

export const IsoTimestampSchema = NonEmptyStringSchema;

export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

export function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function intersectValues<T>(left: readonly T[], right: readonly T[]): T[] {
  const rightSet = new Set(right);
  return uniqueValues(left.filter((value) => rightSet.has(value)));
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function pairKey(left: string, right: string): string {
  return left <= right ? `${left}::${right}` : `${right}::${left}`;
}
