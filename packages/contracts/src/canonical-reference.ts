import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const CanonicalDigestSchema = NonEmptyStringSchema;

export const CanonicalContractRefSchema = z.object({
  id: EntityIdSchema,
  revision: z.number().int().positive(),
  digest: CanonicalDigestSchema
}).strict();

export type CanonicalContractRef = z.infer<typeof CanonicalContractRefSchema>;

export const RepositorySnapshotRefSchema = z.object({
  id: EntityIdSchema,
  digest: CanonicalDigestSchema
}).strict();

export type RepositorySnapshotRef = z.infer<typeof RepositorySnapshotRefSchema>;

export const RepositoryViewRefSchema = z.object({
  digest: CanonicalDigestSchema,
  treeSha: NonEmptyStringSchema,
  resourceCatalogDigest: CanonicalDigestSchema
}).strict();

export type RepositoryViewRef = z.infer<typeof RepositoryViewRefSchema>;
