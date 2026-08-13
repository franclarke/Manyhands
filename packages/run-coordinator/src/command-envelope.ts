import {
  CanonicalDigestSchema,
  computeCanonicalDigest,
  type DigestHasher
} from "@manyhands/contracts";
import { EntityIdSchema } from "@manyhands/shared";
import { z } from "zod";

export type { DigestHasher } from "@manyhands/contracts";

export type RunCommandJsonValue =
  | string
  | number
  | boolean
  | null
  | RunCommandJsonValue[]
  | { [key: string]: RunCommandJsonValue };

export const RunCommandJsonValueSchema: z.ZodType<RunCommandJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(RunCommandJsonValueSchema),
  z.record(RunCommandJsonValueSchema)
]));

export const RunCommandPayloadSchema = z.record(RunCommandJsonValueSchema).superRefine((command, context) => {
  if (typeof command.type !== "string" || command.type.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["type"],
      message: "run command type must be a non-empty string"
    });
  }
});

export const RunCommandIdentityMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  runId: EntityIdSchema,
  /** Optimistic sequence of the run journal/projection, never a graph revision. */
  expectedRevision: z.number().int().nonnegative(),
  command: RunCommandPayloadSchema
}).strict();

export const RunCommandEnvelopeInputSchema = z.object({
  commandId: EntityIdSchema,
  runId: EntityIdSchema,
  /** Optimistic sequence of the run journal/projection, never a graph revision. */
  expectedRevision: z.number().int().nonnegative(),
  submittedAt: z.string().datetime({ offset: true }),
  command: RunCommandPayloadSchema
}).strict();

export const RunCommandEnvelopeSchema = RunCommandEnvelopeInputSchema.extend({
  schemaVersion: z.literal(1),
  commandDigest: CanonicalDigestSchema
}).strict();

export type RunCommandPayload = z.infer<typeof RunCommandPayloadSchema>;
export type RunCommandIdentityMaterial = z.infer<typeof RunCommandIdentityMaterialSchema>;
export type RunCommandEnvelopeInput = z.infer<typeof RunCommandEnvelopeInputSchema>;
export type RunCommandEnvelope = z.infer<typeof RunCommandEnvelopeSchema>;

/**
 * Durable acknowledgement that a run actor accepted and flushed a command.
 * It does not claim that any long-running work requested by the command ended.
 */
export const CommandReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  commandId: EntityIdSchema,
  runId: EntityIdSchema,
  commandDigest: CanonicalDigestSchema,
  acceptedRevision: z.number().int().positive(),
  daemonEpoch: EntityIdSchema,
  acceptedAt: z.string().datetime({ offset: true })
}).strict();

export const CommandReceiptSchema = CommandReceiptMaterialSchema.extend({
  receiptId: CanonicalDigestSchema
}).strict();

export type CommandReceiptMaterial = z.infer<typeof CommandReceiptMaterialSchema>;
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

export function buildCommandReceipt(
  input: CommandReceiptMaterial,
  hasher: DigestHasher
): CommandReceipt {
  const material = CommandReceiptMaterialSchema.parse(input);
  return CommandReceiptSchema.parse({
    receiptId: computeCanonicalDigest(material, hasher),
    ...material
  });
}

export type CommandReceiptIdentityIssueCode = "schema_invalid" | "receipt_id_mismatch";

export interface CommandReceiptIdentityValidationResult {
  ok: boolean;
  issues: Array<{ code: CommandReceiptIdentityIssueCode; message: string }>;
}

export function validateCommandReceiptIdentity(
  input: unknown,
  hasher: DigestHasher
): CommandReceiptIdentityValidationResult {
  const parsed = CommandReceiptSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [{ code: "schema_invalid", message: "command receipt does not match schema version 1" }]
    };
  }
  const { receiptId, ...material } = parsed.data;
  if (computeCanonicalDigest(material, hasher) !== receiptId) {
    return {
      ok: false,
      issues: [{
        code: "receipt_id_mismatch",
        message: "receiptId does not identify the exact durable command acknowledgement"
      }]
    };
  }
  return { ok: true, issues: [] };
}

export function buildRunCommandEnvelope(
  input: RunCommandEnvelopeInput,
  hasher: DigestHasher
): RunCommandEnvelope {
  const parsed = RunCommandEnvelopeInputSchema.parse(input);
  const identity = commandIdentityMaterial(parsed);
  return RunCommandEnvelopeSchema.parse({
    schemaVersion: 1,
    ...parsed,
    commandDigest: computeCanonicalDigest(identity, hasher)
  });
}

export type RunCommandEnvelopeIdentityIssueCode = "schema_invalid" | "command_digest_mismatch";

export interface RunCommandEnvelopeIdentityIssue {
  code: RunCommandEnvelopeIdentityIssueCode;
  message: string;
}

export interface RunCommandEnvelopeIdentityValidationResult {
  ok: boolean;
  issues: RunCommandEnvelopeIdentityIssue[];
}

export function validateRunCommandEnvelopeIdentity(
  input: unknown,
  hasher: DigestHasher
): RunCommandEnvelopeIdentityValidationResult {
  const parsed = RunCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [{ code: "schema_invalid", message: "run command envelope does not match schema version 1" }]
    };
  }

  const expectedDigest = computeCanonicalDigest(commandIdentityMaterial(parsed.data), hasher);
  if (parsed.data.commandDigest !== expectedDigest) {
    return {
      ok: false,
      issues: [{
        code: "command_digest_mismatch",
        message: "commandDigest does not identify the canonical run command identity"
      }]
    };
  }
  return { ok: true, issues: [] };
}

export type RunCommandReplayClassification =
  | { kind: "new"; envelope: RunCommandEnvelope }
  | { kind: "duplicate"; envelope: RunCommandEnvelope }
  | {
    kind: "conflict";
    commandId: string;
    existingCommandDigest: string;
    incomingCommandDigest: string;
  };

export function classifyRunCommandReplay(
  existing: unknown | undefined,
  incoming: unknown,
  hasher: DigestHasher
): RunCommandReplayClassification {
  const incomingEnvelope = parseVerifiedEnvelope(incoming, hasher, "incoming");
  if (existing === undefined) return { kind: "new", envelope: incomingEnvelope };

  const existingEnvelope = parseVerifiedEnvelope(existing, hasher, "existing");
  if (existingEnvelope.commandId !== incomingEnvelope.commandId) {
    return { kind: "new", envelope: incomingEnvelope };
  }
  if (existingEnvelope.commandDigest === incomingEnvelope.commandDigest) {
    return { kind: "duplicate", envelope: existingEnvelope };
  }
  return {
    kind: "conflict",
    commandId: incomingEnvelope.commandId,
    existingCommandDigest: existingEnvelope.commandDigest,
    incomingCommandDigest: incomingEnvelope.commandDigest
  };
}

function parseVerifiedEnvelope(input: unknown, hasher: DigestHasher, label: string): RunCommandEnvelope {
  const parsed = RunCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw new TypeError(`${label} run command envelope does not match schema version 1`);
  const validation = validateRunCommandEnvelopeIdentity(parsed.data, hasher);
  if (!validation.ok) {
    throw new TypeError(`${label} run command envelope has invalid identity: ${validation.issues[0]?.code ?? "unknown"}`);
  }
  return parsed.data;
}

function commandIdentityMaterial(
  envelope: Pick<RunCommandEnvelopeInput, "runId" | "expectedRevision" | "command">
): RunCommandIdentityMaterial {
  return {
    schemaVersion: 1,
    runId: envelope.runId,
    expectedRevision: envelope.expectedRevision,
    command: envelope.command
  };
}
