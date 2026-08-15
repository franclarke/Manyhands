import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

/**
 * Why recovery could not continue, with the evidence that makes it actionable.
 *
 * Recovery failures used to reach an operator as prose. "The delivery target
 * changed" names neither the ref nor either OID, so it cannot distinguish a
 * branch that advanced to an ancestor of the candidate from one that moved to
 * an unrelated commit — situations with different answers. Each member here
 * carries the identifiers a person needs to decide, and the schema is what
 * keeps a future member from being added without them.
 */
export const RecoveryDiagnosticSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("corrupt_journal"),
    runId: EntityIdSchema,
    sequence: z.number().int().nonnegative(),
    detail: NonEmptyStringSchema
  }).strict(),
  z.object({
    kind: z.literal("missing_object"),
    oid: NonEmptyStringSchema,
    expectedBy: NonEmptyStringSchema
  }).strict(),
  z.object({
    kind: z.literal("unresolved_process"),
    processId: NonEmptyStringSchema,
    lastReceiptId: NonEmptyStringSchema
  }).strict(),
  z.object({
    kind: z.literal("stale_decision"),
    decisionId: EntityIdSchema,
    raisedAtGraphRevision: z.number().int().nonnegative(),
    currentGraphRevision: z.number().int().nonnegative()
  }).strict(),
  z.object({
    kind: z.literal("target_divergence"),
    ref: NonEmptyStringSchema,
    expectedOid: NonEmptyStringSchema,
    actualOid: NonEmptyStringSchema
  }).strict(),
  z.object({
    kind: z.literal("unrecoverable_external_effect"),
    effectId: NonEmptyStringSchema,
    detail: NonEmptyStringSchema
  }).strict()
]);

export type RecoveryDiagnostic = z.infer<typeof RecoveryDiagnosticSchema>;

/** One operator-facing line that repeats the diagnostic's own evidence. */
export function describeRecoveryDiagnostic(diagnostic: RecoveryDiagnostic): string {
  switch (diagnostic.kind) {
    case "corrupt_journal":
      return `The journal for ${diagnostic.runId} is unreadable at record ${diagnostic.sequence}: ${diagnostic.detail}.`;
    case "missing_object":
      return `Object ${diagnostic.oid}, required by ${diagnostic.expectedBy}, is not in the repository.`;
    case "unresolved_process":
      return `Process ${diagnostic.processId} has no terminal outcome after receipt ${diagnostic.lastReceiptId}.`;
    case "stale_decision":
      return `Decision ${diagnostic.decisionId} was raised at graph revision ${diagnostic.raisedAtGraphRevision} and the graph is now at revision ${diagnostic.currentGraphRevision}.`;
    case "target_divergence":
      return `Ref ${diagnostic.ref} was expected at ${diagnostic.expectedOid} and holds ${diagnostic.actualOid}; nothing was published.`;
    case "unrecoverable_external_effect":
      return `External effect ${diagnostic.effectId} cannot be reconciled: ${diagnostic.detail}.`;
  }
}
