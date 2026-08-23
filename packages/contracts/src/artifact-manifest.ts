import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { computeCanonicalDigest, type DigestHasher } from "./canonical-json.js";
import { CanonicalContractRefSchema, CanonicalDigestSchema } from "./canonical-reference.js";
import { RepoRelativePathSchema } from "./contract-identity.js";

const GitOidSchema = NonEmptyStringSchema.regex(/^[0-9a-f]+$/u, "Git OID must be lowercase hexadecimal");
const GitModeSchema = NonEmptyStringSchema.regex(/^[0-7]{6}$/u, "Git mode must contain six octal digits");

export const ManifestIdentitySchema = z.object({
  id: EntityIdSchema,
  contract: CanonicalContractRefSchema,
  producerNodeId: EntityIdSchema,
  producerAttemptId: EntityIdSchema,
  inputFingerprint: CanonicalDigestSchema,
  repositoryObjectStoreId: EntityIdSchema,
  objectFormat: z.enum(["sha1", "sha256"]),
  sourceCandidate: z.object({ commitOid: GitOidSchema, treeOid: GitOidSchema }).strict(),
  retainedByRef: NonEmptyStringSchema
}).strict();
export type ManifestIdentity = z.infer<typeof ManifestIdentitySchema>;

export const ChangeSetEntrySchema = z.object({
  oldPath: RepoRelativePathSchema.optional(),
  newPath: RepoRelativePathSchema.optional(),
  operation: z.enum(["add", "modify", "delete", "type_change"]),
  oldOid: GitOidSchema.optional(),
  newOid: GitOidSchema.optional(),
  oldMode: GitModeSchema.optional(),
  newMode: GitModeSchema.optional(),
  detectedRenameFrom: RepoRelativePathSchema.optional()
}).strict().superRefine((entry, context) => {
  if (entry.operation === "add") {
    if (entry.newPath === undefined || entry.newOid === undefined || entry.newMode === undefined) {
      issue(context, [], "add requires newPath, newOid and newMode");
    }
    if (entry.oldPath !== undefined || entry.oldOid !== undefined || entry.oldMode !== undefined) {
      issue(context, [], "add must not declare an oldPath, oldOid or oldMode preimage");
    }
    return;
  }
  if (entry.operation === "delete") {
    if (entry.oldPath === undefined || entry.oldOid === undefined || entry.oldMode === undefined) {
      issue(context, [], "delete requires oldPath, oldOid and oldMode");
    }
    if (entry.newPath !== undefined || entry.newOid !== undefined || entry.newMode !== undefined) {
      issue(context, [], "delete must not declare a newPath, newOid or newMode postimage");
    }
    if (entry.detectedRenameFrom !== undefined) {
      issue(context, ["detectedRenameFrom"], "detectedRenameFrom is explanatory metadata only for an add entry");
    }
    return;
  }
  if (
    entry.oldPath === undefined || entry.newPath === undefined || entry.oldOid === undefined ||
    entry.newOid === undefined || entry.oldMode === undefined || entry.newMode === undefined
  ) {
    issue(context, [], `${entry.operation} requires exact old and new path, OID and mode`);
  }
  if (entry.oldPath !== undefined && entry.newPath !== undefined && entry.oldPath !== entry.newPath) {
    issue(context, ["newPath"], `${entry.operation} cannot change paths; represent a rename as delete plus add`);
  }
  if (
    entry.operation === "modify" &&
    entry.oldMode !== undefined &&
    entry.newMode !== undefined &&
    gitObjectType(entry.oldMode) !== gitObjectType(entry.newMode)
  ) {
    issue(context, ["newMode"], "modify must preserve the Git object type; use type_change when the type changes");
  }
  if (
    entry.operation === "type_change" &&
    entry.oldMode !== undefined &&
    entry.newMode !== undefined &&
    gitObjectType(entry.oldMode) === gitObjectType(entry.newMode)
  ) {
    issue(context, ["newMode"], "type_change requires the Git object type to change");
  }
  if (entry.detectedRenameFrom !== undefined) {
    issue(context, ["detectedRenameFrom"], "detectedRenameFrom is explanatory metadata only for an add entry");
  }
});
export type ChangeSetEntry = z.infer<typeof ChangeSetEntrySchema>;

const ManifestIdentityShape = ManifestIdentitySchema.shape;
const ChangeSetManifestMaterialObjectSchema = z.object({
  ...ManifestIdentityShape,
  kind: z.literal("change_set"),
  baseTreeSha: GitOidSchema,
  resultTreeSha: GitOidSchema,
  entries: z.array(ChangeSetEntrySchema)
}).strict();

export const ChangeSetManifestMaterialSchema = ChangeSetManifestMaterialObjectSchema.superRefine((value, context) => {
  validateOidLengths(value, context);
  validateUniqueEntries(value.entries, context);
});
export const ChangeSetManifestSchema = ChangeSetManifestMaterialObjectSchema.extend({
  manifestDigest: CanonicalDigestSchema
}).strict().superRefine((value, context) => {
  validateOidLengths(value, context);
  validateUniqueEntries(value.entries, context);
});

const CandidateTreeManifestMaterialObjectSchema = z.object({
  ...ManifestIdentityShape,
  kind: z.literal("candidate_tree"),
  baseCommitOid: GitOidSchema,
  commitOid: GitOidSchema,
  treeOid: GitOidSchema
}).strict();

export const CandidateTreeManifestMaterialSchema = CandidateTreeManifestMaterialObjectSchema.superRefine(validateOidLengths);
export const CandidateTreeManifestSchema = CandidateTreeManifestMaterialObjectSchema.extend({
  manifestDigest: CanonicalDigestSchema
}).strict().superRefine(validateOidLengths);

export const ArtifactManifestSchema = z.union([ChangeSetManifestSchema, CandidateTreeManifestSchema]);
export type ChangeSetManifestMaterial = z.infer<typeof ChangeSetManifestMaterialSchema>;
export type CandidateTreeManifestMaterial = z.infer<typeof CandidateTreeManifestMaterialSchema>;
export type ChangeSetManifest = z.infer<typeof ChangeSetManifestSchema>;
export type CandidateTreeManifest = z.infer<typeof CandidateTreeManifestSchema>;
export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;

export function buildChangeSetManifest(input: unknown, hasher: DigestHasher): ChangeSetManifest {
  const parsed = ChangeSetManifestMaterialSchema.parse(input);
  const material: ChangeSetManifestMaterial = { ...parsed, entries: normalizeEntries(parsed.entries) };
  return { ...material, manifestDigest: computeCanonicalDigest(material, hasher) };
}

export function buildCandidateTreeManifest(input: unknown, hasher: DigestHasher): CandidateTreeManifest {
  const material = CandidateTreeManifestMaterialSchema.parse(input);
  return { ...material, manifestDigest: computeCanonicalDigest(material, hasher) };
}

export type ManifestIdentityIssueCode = "schema_invalid" | "manifest_digest_mismatch" | "source_candidate_mismatch";
export interface ManifestIdentityIssue { code: ManifestIdentityIssueCode; message: string; }
export interface ManifestIdentityValidationResult { ok: boolean; issues: ManifestIdentityIssue[]; }

export function validateManifestIdentity(input: unknown, hasher: DigestHasher): ManifestIdentityValidationResult {
  const parsed = ArtifactManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((item) => ({ code: "schema_invalid", message: `${item.path.join(".")}: ${item.message}` }))
    };
  }
  const manifest = parsed.data;
  const { manifestDigest, ...material } = manifest;
  const issues: ManifestIdentityIssue[] = [];
  if (computeCanonicalDigest(material, hasher) !== manifestDigest) {
    issues.push({ code: "manifest_digest_mismatch", message: "manifestDigest does not identify the canonical immutable manifest material" });
  }
  if (
    manifest.kind === "candidate_tree" &&
    (manifest.sourceCandidate.commitOid !== manifest.commitOid || manifest.sourceCandidate.treeOid !== manifest.treeOid)
  ) {
    issues.push({ code: "source_candidate_mismatch", message: "sourceCandidate does not identify the manifest candidate commit/tree" });
  }
  return { ok: issues.length === 0, issues };
}

function normalizeEntries(entries: readonly ChangeSetEntry[]): ChangeSetEntry[] {
  return [...entries].sort((left, right) => entryIdentity(left).localeCompare(entryIdentity(right)));
}

function entryIdentity(entry: ChangeSetEntry): string {
  return `${entry.oldPath ?? ""}\0${entry.newPath ?? ""}\0${entry.operation}`;
}

function validateUniqueEntries(entries: readonly ChangeSetEntry[], context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const identity = entryIdentity(entry);
    if (seen.has(identity)) issue(context, ["entries", index], "change-set entries must be unique");
    seen.add(identity);
  }
}

function validateOidLengths(value: ManifestIdentity & Record<string, unknown>, context: z.RefinementCtx): void {
  const expectedLength = value.objectFormat === "sha1" ? 40 : 64;
  visitOidFields(value, [], (path, oid) => {
    if (oid.length !== expectedLength) issue(context, path, `${value.objectFormat} OID must contain ${expectedLength} hex digits`);
  });
}

function visitOidFields(
  value: unknown,
  path: Array<string | number>,
  visit: (path: Array<string | number>, oid: string) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitOidFields(item, [...path, index], visit));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key.endsWith("Oid") || key.endsWith("Sha")) && typeof item === "string") visit([...path, key], item);
    else visitOidFields(item, [...path, key], visit);
  }
}

function issue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function gitObjectType(mode: string): string {
  return mode.slice(0, 3);
}
