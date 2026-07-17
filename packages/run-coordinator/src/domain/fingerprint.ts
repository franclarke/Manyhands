import { createHash } from "node:crypto";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

const ContractRevisionRefSchema = z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict();
const GraphRevisionRefSchema = z.object({ id: EntityIdSchema, revision: z.number().int().positive() }).strict();
const ArtifactDigestRefSchema = z.object({ id: EntityIdSchema, digest: NonEmptyStringSchema }).strict();

export const InputFingerprintSourceSchema = z.object({
  graph: GraphRevisionRefSchema,
  nodeId: EntityIdSchema,
  contractRevisions: z.array(ContractRevisionRefSchema).min(1),
  baseCommit: NonEmptyStringSchema,
  consumedArtifacts: z.array(ArtifactDigestRefSchema),
  repositoryContextDigest: NonEmptyStringSchema,
  executorProfile: ContractRevisionRefSchema,
  validationContract: ContractRevisionRefSchema
}).strict().superRefine((input, context) => {
  for (const [path, values] of [["contractRevisions", input.contractRevisions], ["consumedArtifacts", input.consumedArtifacts]] as const) {
    const ids = values.map((item) => item.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${path} must contain unique ids` });
  }
});

export type InputFingerprintSource = z.infer<typeof InputFingerprintSourceSchema>;

export function computeInputFingerprint(raw: InputFingerprintSource): string {
  const input = InputFingerprintSourceSchema.parse(raw);
  const canonical = {
    ...input,
    contractRevisions: [...input.contractRevisions].sort(compareRef),
    consumedArtifacts: [...input.consumedArtifacts].sort(compareRef)
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

function compareRef(left: { id: string }, right: { id: string }): number { return left.id.localeCompare(right.id); }
