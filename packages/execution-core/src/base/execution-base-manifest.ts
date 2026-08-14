import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { ArtifactManifestSchema } from "@manyhands/contracts";

export const InputFingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

const ExecutionArtifactInputObjectSchema = z.object({
  artifactId: EntityIdSchema,
  digest: NonEmptyStringSchema,
  contract: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
  kind: z.enum(["commit", "files", "manifest", "logical"]),
  location: NonEmptyStringSchema,
  manifest: ArtifactManifestSchema.optional(),
  cherryPickMainline: z.literal(1).optional()
}).strict();

export const ExecutionArtifactInputSchema = ExecutionArtifactInputObjectSchema.superRefine((artifact, context) => {
  if (artifact.kind === "manifest" && artifact.manifest === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["manifest"], message: "manifest artifacts require immutable manifest content" });
  }
  if (artifact.kind === "manifest" && artifact.manifest?.manifestDigest !== artifact.location) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["location"], message: "manifest location must equal its immutable digest" });
  }
});

export type ExecutionArtifactInput = z.infer<typeof ExecutionArtifactInputSchema>;

export const MaterializedArtifactSchema = ExecutionArtifactInputObjectSchema.extend({
  beforeCommit: NonEmptyStringSchema,
  resultingCommit: NonEmptyStringSchema
}).strict();

export const ExecutionBaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: EntityIdSchema,
  nodeId: EntityIdSchema,
  baseCommit: NonEmptyStringSchema,
  contractBaseline: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
  materializedArtifacts: z.array(MaterializedArtifactSchema),
  resultingCommit: NonEmptyStringSchema,
  inputFingerprint: InputFingerprintSchema,
  createdAt: IsoTimestampSchema
}).strict();

export type ExecutionBaseManifest = z.infer<typeof ExecutionBaseManifestSchema>;

export class ExecutionAttemptFingerprintMismatchError extends Error {
  readonly expected: string;
  readonly observed: string;

  constructor(expected: string, observed: string) {
    super(`Execution input fingerprint mismatch: reserved ${expected}, observed ${observed}.`);
    this.name = "ExecutionAttemptFingerprintMismatchError";
    this.expected = expected;
    this.observed = observed;
  }
}

export function assertExecutionAttemptFingerprint(expected: string, observed: string): string {
  const validExpected = InputFingerprintSchema.parse(expected);
  const validObserved = InputFingerprintSchema.parse(observed);
  if (validExpected !== validObserved) {
    throw new ExecutionAttemptFingerprintMismatchError(validExpected, validObserved);
  }
  return validObserved;
}
