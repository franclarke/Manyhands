import { ArtifactManifestSchema } from "@manyhands/contracts";
import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

const AdoptedArtifactObjectSchema = z.object({
  schemaVersion: z.literal(1),
  artifactId: EntityIdSchema,
  runId: EntityIdSchema,
  nodeId: EntityIdSchema,
  digest: NonEmptyStringSchema,
  producerAttemptId: EntityIdSchema,
  contract: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
  kind: z.enum(["commit", "files", "manifest", "logical"]),
  location: NonEmptyStringSchema,
  manifest: ArtifactManifestSchema.optional(),
  cherryPickMainline: z.literal(1).optional(),
  adoptedAt: IsoTimestampSchema
}).strict();

export const AdoptedArtifactSchema = AdoptedArtifactObjectSchema.superRefine((artifact, context) => {
  if (artifact.kind === "manifest") {
    if (artifact.manifest === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["manifest"], message: "A manifest artifact requires its immutable manifest material." });
    } else if (artifact.location !== artifact.manifest.manifestDigest) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["location"], message: "A manifest artifact location must equal its manifest digest." });
    }
  } else if (artifact.manifest !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["manifest"], message: "Only manifest artifacts may embed manifest material." });
  }
});

export type AdoptedArtifact = z.infer<typeof AdoptedArtifactSchema>;

/** A release may be authorized only after the terminal run journal proves no live consumer remains. */
export const ArtifactRetentionReleaseAuthorizationSchema = z.object({
  decisionId: EntityIdSchema,
  artifactId: EntityIdSchema,
  retainedByRef: NonEmptyStringSchema,
  candidateCommit: NonEmptyStringSchema,
  authorizedAt: IsoTimestampSchema
}).strict();

export type ArtifactRetentionReleaseAuthorization = z.infer<typeof ArtifactRetentionReleaseAuthorizationSchema>;
