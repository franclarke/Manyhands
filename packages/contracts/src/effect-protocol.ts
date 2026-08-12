import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { canonicalJson, computeCanonicalDigest, type DigestHasher } from "./canonical-json.js";
import { CanonicalDigestSchema } from "./canonical-reference.js";

const StrictIsoTimestampSchema = z.string().datetime({ offset: true });

export const EffectKindSchema = z.enum([
  "model_call",
  "process_spawn",
  "process_terminate",
  "sandbox_create",
  "git_mutation",
  "artifact_materialize",
  "validation",
  "delivery",
  "cleanup"
]);
export type EffectKind = z.infer<typeof EffectKindSchema>;

export const EffectIdempotencySchema = z.enum([
  "repeat_safe",
  "reconcile_then_repeat",
  "never_repeat_unknown"
]);
export type EffectIdempotency = z.infer<typeof EffectIdempotencySchema>;

export const EffectIntentMaterialSchema = z.object({
  runId: EntityIdSchema,
  attemptId: EntityIdSchema.optional(),
  kind: EffectKindSchema,
  inputDigest: CanonicalDigestSchema,
  daemonEpoch: EntityIdSchema,
  idempotency: EffectIdempotencySchema,
  requestedAt: StrictIsoTimestampSchema
}).strict();

export const EffectIntentSchema = EffectIntentMaterialSchema.extend({
  effectId: NonEmptyStringSchema
}).strict();

export type EffectIntentMaterial = z.infer<typeof EffectIntentMaterialSchema>;
export type EffectIntent = z.infer<typeof EffectIntentSchema>;

export function buildEffectIntent(input: EffectIntentMaterial, hasher: DigestHasher): EffectIntent {
  const material = EffectIntentMaterialSchema.parse(input);
  return { effectId: computeCanonicalDigest(material, hasher), ...material };
}

export type EffectIntentIdentityIssueCode = "schema_invalid" | "effect_id_mismatch";

export interface EffectIntentIdentityIssue {
  code: EffectIntentIdentityIssueCode;
  message: string;
}

export interface EffectIntentIdentityValidationResult {
  ok: boolean;
  issues: EffectIntentIdentityIssue[];
}

export function validateEffectIntentIdentity(
  input: unknown,
  hasher: DigestHasher
): EffectIntentIdentityValidationResult {
  const parsed = EffectIntentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        message: `${issue.path.join(".")}: ${issue.message}`
      }))
    };
  }

  const { effectId, ...material } = parsed.data;
  if (computeCanonicalDigest(material, hasher) !== effectId) {
    return {
      ok: false,
      issues: [{
        code: "effect_id_mismatch",
        message: "effectId does not identify the exact canonical effect intent material"
      }]
    };
  }

  return { ok: true, issues: [] };
}

export const ProcessIdentitySchema = z.object({
  pid: z.number().int().positive(),
  creationIdentity: NonEmptyStringSchema,
  supervisorNonce: NonEmptyStringSchema
}).strict();
export type ProcessIdentity = z.infer<typeof ProcessIdentitySchema>;

export const PhysicalEffectObservationSchema = z.enum(["started", "succeeded", "failed"]);
export type PhysicalEffectObservation = z.infer<typeof PhysicalEffectObservationSchema>;

export const PhysicalEffectReceiptMaterialSchema = z.object({
  effectId: NonEmptyStringSchema,
  observation: PhysicalEffectObservationSchema,
  inputDigest: CanonicalDigestSchema,
  daemonEpoch: EntityIdSchema,
  processIdentity: ProcessIdentitySchema.optional(),
  resultDigest: CanonicalDigestSchema.optional(),
  observedAt: StrictIsoTimestampSchema
}).strict();

export const PhysicalEffectReceiptSchema = PhysicalEffectReceiptMaterialSchema.extend({
  receiptId: NonEmptyStringSchema
}).strict();

export type PhysicalEffectReceiptMaterial = z.infer<typeof PhysicalEffectReceiptMaterialSchema>;
export type PhysicalEffectReceipt = z.infer<typeof PhysicalEffectReceiptSchema>;

export function buildPhysicalEffectReceipt(
  input: PhysicalEffectReceiptMaterial,
  hasher: DigestHasher
): PhysicalEffectReceipt {
  const material = PhysicalEffectReceiptMaterialSchema.parse(input);
  return { receiptId: computeCanonicalDigest(material, hasher), ...material };
}

export type PhysicalEffectReceiptIdentityIssueCode = "schema_invalid" | "receipt_id_mismatch";

export interface PhysicalEffectReceiptIdentityIssue {
  code: PhysicalEffectReceiptIdentityIssueCode;
  message: string;
}

export interface PhysicalEffectReceiptIdentityValidationResult {
  ok: boolean;
  issues: PhysicalEffectReceiptIdentityIssue[];
}

export function validatePhysicalEffectReceiptIdentity(
  input: unknown,
  hasher: DigestHasher
): PhysicalEffectReceiptIdentityValidationResult {
  const parsed = PhysicalEffectReceiptSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        message: `${issue.path.join(".")}: ${issue.message}`
      }))
    };
  }

  const { receiptId, ...material } = parsed.data;
  if (computeCanonicalDigest(material, hasher) !== receiptId) {
    return {
      ok: false,
      issues: [{
        code: "receipt_id_mismatch",
        message: "receiptId does not identify the exact canonical physical observation"
      }]
    };
  }

  return { ok: true, issues: [] };
}

export type PhysicalEffectReceiptBindingIssueCode =
  | "intent_identity_invalid"
  | "receipt_identity_invalid"
  | "effect_binding_mismatch"
  | "input_digest_mismatch"
  | "daemon_epoch_mismatch";

export interface PhysicalEffectReceiptBindingIssue {
  code: PhysicalEffectReceiptBindingIssueCode;
  message: string;
}

export interface PhysicalEffectReceiptBindingValidationResult {
  ok: boolean;
  issues: PhysicalEffectReceiptBindingIssue[];
}

export function validatePhysicalEffectReceiptBinding(
  receiptInput: unknown,
  intentInput: unknown,
  hasher: DigestHasher
): PhysicalEffectReceiptBindingValidationResult {
  const intentIdentity = validateEffectIntentIdentity(intentInput, hasher);
  const receiptIdentity = validatePhysicalEffectReceiptIdentity(receiptInput, hasher);
  const issues: PhysicalEffectReceiptBindingIssue[] = [];

  if (!intentIdentity.ok) {
    issues.push({
      code: "intent_identity_invalid",
      message: "receipt binding requires a schema-valid intent with a valid canonical effectId"
    });
  }
  if (!receiptIdentity.ok) {
    issues.push({
      code: "receipt_identity_invalid",
      message: "receipt binding requires a schema-valid receipt with a valid canonical receiptId"
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  const intent = EffectIntentSchema.parse(intentInput);
  const receipt = PhysicalEffectReceiptSchema.parse(receiptInput);
  if (receipt.effectId !== intent.effectId) {
    issues.push({
      code: "effect_binding_mismatch",
      message: "physical receipt belongs to a different effect intent"
    });
  }
  if (receipt.inputDigest !== intent.inputDigest) {
    issues.push({
      code: "input_digest_mismatch",
      message: "physical receipt observed different effect inputs"
    });
  }
  if (receipt.daemonEpoch !== intent.daemonEpoch) {
    issues.push({
      code: "daemon_epoch_mismatch",
      message: "physical receipt was produced under a different daemon epoch"
    });
  }

  return { ok: issues.length === 0, issues };
}

export type PhysicalEffectReceiptReplayIssueCode =
  | "schema_invalid"
  | "receipt_id_mismatch"
  | "receipt_id_conflict";

export interface PhysicalEffectReceiptReplayIssue {
  code: PhysicalEffectReceiptReplayIssueCode;
  message: string;
  index: number;
  receiptId?: string;
}

export interface PhysicalEffectReceiptReplayResult {
  ok: boolean;
  receipts: PhysicalEffectReceipt[];
  identicalReplayReceiptIds: string[];
  issues: PhysicalEffectReceiptReplayIssue[];
}

/**
 * Replays an append-only receipt stream without inventing mutable lifecycle
 * state. Repeating the exact same receipt is idempotent; reusing a receiptId
 * for different observation material is corruption and fails closed.
 */
export function replayPhysicalEffectReceipts(
  input: readonly unknown[],
  hasher: DigestHasher
): PhysicalEffectReceiptReplayResult {
  const byId = new Map<string, PhysicalEffectReceipt>();
  const identicalReplayReceiptIds = new Set<string>();
  const issues: PhysicalEffectReceiptReplayIssue[] = [];

  for (const [index, item] of input.entries()) {
    const parsed = PhysicalEffectReceiptSchema.safeParse(item);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((issue) => ({
        code: "schema_invalid" as const,
        index,
        message: `${issue.path.join(".")}: ${issue.message}`
      })));
      continue;
    }

    const receipt = parsed.data;
    const existing = byId.get(receipt.receiptId);
    if (existing !== undefined) {
      if (canonicalJson(existing) === canonicalJson(receipt)) {
        identicalReplayReceiptIds.add(receipt.receiptId);
      } else {
        issues.push({
          code: "receipt_id_conflict",
          index,
          receiptId: receipt.receiptId,
          message: `receiptId ${receipt.receiptId} identifies conflicting physical observations`
        });
      }
      continue;
    }

    const identity = validatePhysicalEffectReceiptIdentity(receipt, hasher);
    if (!identity.ok) {
      issues.push(...identity.issues.map((issue) => ({
        code: issue.code,
        index,
        receiptId: receipt.receiptId,
        message: issue.message
      })));
      continue;
    }

    byId.set(receipt.receiptId, receipt);
  }

  return {
    ok: issues.length === 0,
    receipts: [...byId.values()],
    identicalReplayReceiptIds: [...identicalReplayReceiptIds],
    issues
  };
}
