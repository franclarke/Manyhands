import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { ArtifactManifestSchema } from "@manyhands/contracts";
import { z } from "zod";

export const InputFingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

const ExecutionArtifactInputObjectSchema = z.object({
  artifactId: EntityIdSchema,
  digest: NonEmptyStringSchema,
  contract: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
  kind: z.enum(["commit", "files", "manifest", "logical"]),
  location: NonEmptyStringSchema,
  cherryPickMainline: z.literal(1).optional(),
  manifest: ArtifactManifestSchema.optional()
}).strict();

function validateManifestArtifact(artifact: z.infer<typeof ExecutionArtifactInputObjectSchema>, context: z.RefinementCtx): void {
  if (artifact.kind === "manifest" && artifact.manifest === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["manifest"], message: "Manifest artifacts require immutable manifest content." });
  }
  if (artifact.kind !== "manifest" && artifact.manifest !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["manifest"], message: "Only manifest artifacts may carry immutable manifest content." });
  }
}

export const ExecutionArtifactInputSchema = ExecutionArtifactInputObjectSchema.superRefine(validateManifestArtifact);

export type ExecutionArtifactInput = z.infer<typeof ExecutionArtifactInputSchema>;

export const MaterializedArtifactSchema = ExecutionArtifactInputObjectSchema.extend({
  beforeCommit: NonEmptyStringSchema,
  resultingCommit: NonEmptyStringSchema
}).strict().superRefine(validateManifestArtifact);

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
