import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const ContractRevisionSchema = NonEmptyStringSchema;
export type ContractRevision = z.infer<typeof ContractRevisionSchema>;

export const ContractProvenanceSchema = z.enum(["authored", "compiled", "legacy_inferred"]);
export type ContractProvenance = z.infer<typeof ContractProvenanceSchema>;

export const ContractReferenceSchema = z.object({
  id: EntityIdSchema,
  revision: ContractRevisionSchema
}).strict();
export type ContractReference = z.infer<typeof ContractReferenceSchema>;

export const ContractIdentitySchema = z.object({
  schemaVersion: z.literal(2),
  id: EntityIdSchema,
  revision: ContractRevisionSchema,
  provenance: ContractProvenanceSchema
}).strict();

export const ContractIdentityShape = ContractIdentitySchema.shape;

export const RepoRelativePathSchema = NonEmptyStringSchema.superRefine((value, context) => {
  const reason = unsafeRepoRelativePathReason(value);
  if (reason !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: reason });
  }
});

function unsafeRepoRelativePathReason(value: string): string | undefined {
  const candidate = value.trim();
  if (/[\u0000-\u001F]/u.test(candidate)) return "path contains control characters";
  if (candidate.startsWith("/") || candidate.startsWith("\\")) return "path must be repository-relative";
  if (/^[A-Za-z]:/u.test(candidate)) return "path must not use a Windows drive prefix";
  if (candidate.startsWith("~")) return "path must not target a home directory";
  if (candidate.replaceAll("\\", "/").split("/").includes("..")) return "path traversal is not allowed";
  return undefined;
}

export function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  field: string
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field, index],
        message: `${field} must not contain duplicate id "${value}"`
      });
    }
    seen.add(value);
  }
}
