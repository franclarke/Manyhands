import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const AdoptedArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  artifactId: EntityIdSchema,
  runId: EntityIdSchema,
  nodeId: EntityIdSchema,
  digest: NonEmptyStringSchema,
  producerAttemptId: EntityIdSchema,
  contract: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
  kind: z.enum(["commit", "files", "manifest", "logical"]),
  location: NonEmptyStringSchema,
  cherryPickMainline: z.literal(1).optional(),
  adoptedAt: IsoTimestampSchema
}).strict();

export type AdoptedArtifact = z.infer<typeof AdoptedArtifactSchema>;
