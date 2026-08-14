import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const InputFingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const ExecutionArtifactInputSchema = z.object({
  artifactId: EntityIdSchema,
  digest: NonEmptyStringSchema,
  contract: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
  kind: z.enum(["commit", "files", "manifest", "logical"]),
  location: NonEmptyStringSchema,
  cherryPickMainline: z.literal(1).optional()
}).strict();

export type ExecutionArtifactInput = z.infer<typeof ExecutionArtifactInputSchema>;

export const MaterializedArtifactSchema = ExecutionArtifactInputSchema.extend({
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
