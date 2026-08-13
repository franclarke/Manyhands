import { canonicalJson } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { RunCommandEnvelopeSchema } from "./command-envelope.js";

export const IPC_PROTOCOL_VERSION = 1 as const;
export const IPC_DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
export const IPC_DEFAULT_MAX_CLOCK_SKEW_MS = 30_000;
export const IPC_DEFAULT_NONCE_TTL_MS = IPC_DEFAULT_MAX_CLOCK_SKEW_MS * 2;
export const IPC_DEFAULT_MAX_NONCES = 4_096;

export type IpcCapabilityPathKind = "directory" | "file";
export type IpcCapabilityOsProtection = (
  targetPath: string,
  kind: IpcCapabilityPathKind
) => void | Promise<void>;

export type IpcJsonValue =
  | string
  | number
  | boolean
  | null
  | IpcJsonValue[]
  | { [key: string]: IpcJsonValue };

export const IpcJsonValueSchema: z.ZodType<IpcJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(IpcJsonValueSchema),
  z.record(IpcJsonValueSchema)
]));

export const IpcJsonObjectSchema = z.record(IpcJsonValueSchema);

const IpcRequestIdSchema = EntityIdSchema.max(128);
const IpcNonceSchema = z.string().regex(/^[a-f0-9]{64}$/, "nonce must be 256-bit lowercase hex");
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, "value must be a SHA-256 lowercase hex digest");

export const IpcCapabilityTextSchema = z.string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/, "capability must be unpadded base64url");

export const IpcSubmitRequestBodySchema = z.object({
  kind: z.literal("submit"),
  command: RunCommandEnvelopeSchema
}).strict();

export const IpcQueryRequestBodySchema = z.object({
  kind: z.literal("query"),
  runId: EntityIdSchema,
  query: NonEmptyStringSchema.max(128),
  arguments: IpcJsonObjectSchema.optional()
}).strict();

export const IpcEventsReadyRequestBodySchema = z.object({
  kind: z.literal("events_ready"),
  runId: EntityIdSchema,
  afterSequence: z.number().int().nonnegative()
}).strict();

export const IpcRequestBodySchema = z.discriminatedUnion("kind", [
  IpcSubmitRequestBodySchema,
  IpcQueryRequestBodySchema,
  IpcEventsReadyRequestBodySchema
]);

export type IpcSubmitRequestBody = z.infer<typeof IpcSubmitRequestBodySchema>;
export type IpcQueryRequestBody = z.infer<typeof IpcQueryRequestBodySchema>;
export type IpcEventsReadyRequestBody = z.infer<typeof IpcEventsReadyRequestBodySchema>;
export type IpcRequestBody = z.infer<typeof IpcRequestBodySchema>;

export const IpcUnsignedRequestSchema = z.object({
  version: z.literal(IPC_PROTOCOL_VERSION),
  requestId: IpcRequestIdSchema,
  nonce: IpcNonceSchema,
  issuedAtMs: z.number().int().nonnegative(),
  bodyDigest: Sha256HexSchema,
  body: IpcRequestBodySchema
}).strict();

export const IpcAuthenticatedRequestSchema = IpcUnsignedRequestSchema.extend({
  mac: Sha256HexSchema
}).strict();

export type IpcUnsignedRequest = z.infer<typeof IpcUnsignedRequestSchema>;
export type IpcAuthenticatedRequest = z.infer<typeof IpcAuthenticatedRequestSchema>;

export const IpcSuccessResponseBodySchema = z.object({
  ok: z.literal(true),
  result: IpcJsonValueSchema
}).strict();

export const IpcErrorResponseBodySchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: EntityIdSchema.max(64),
    message: NonEmptyStringSchema.max(512)
  }).strict()
}).strict();

export const IpcResponseBodySchema = z.discriminatedUnion("ok", [
  IpcSuccessResponseBodySchema,
  IpcErrorResponseBodySchema
]);

export type IpcSuccessResponseBody = z.infer<typeof IpcSuccessResponseBodySchema>;
export type IpcErrorResponseBody = z.infer<typeof IpcErrorResponseBodySchema>;
export type IpcResponseBody = z.infer<typeof IpcResponseBodySchema>;

export const IpcUnsignedResponseSchema = z.object({
  version: z.literal(IPC_PROTOCOL_VERSION),
  requestId: IpcRequestIdSchema,
  nonce: IpcNonceSchema,
  issuedAtMs: z.number().int().nonnegative(),
  bodyDigest: Sha256HexSchema,
  body: IpcResponseBodySchema
}).strict();

export const IpcAuthenticatedResponseSchema = IpcUnsignedResponseSchema.extend({
  mac: Sha256HexSchema
}).strict();

export type IpcUnsignedResponse = z.infer<typeof IpcUnsignedResponseSchema>;
export type IpcAuthenticatedResponse = z.infer<typeof IpcAuthenticatedResponseSchema>;

/**
 * Domain-separated request material. The timestamp is bound in addition to the
 * required version/id/nonce/body digest so an attacker cannot refresh a stale
 * signed frame by editing only its clock value.
 */
export function canonicalIpcRequestAuthenticationMaterial(
  request: Pick<IpcUnsignedRequest, "version" | "requestId" | "nonce" | "issuedAtMs" | "bodyDigest">
): string {
  return canonicalJson({
    domain: "manyhands.local-ipc.request",
    version: request.version,
    requestId: request.requestId,
    nonce: request.nonce,
    issuedAtMs: request.issuedAtMs,
    bodyDigest: request.bodyDigest
  });
}

/** Response authentication is bound to the originating request id and nonce. */
export function canonicalIpcResponseAuthenticationMaterial(
  response: Pick<IpcUnsignedResponse, "version" | "requestId" | "nonce" | "issuedAtMs" | "bodyDigest">
): string {
  return canonicalJson({
    domain: "manyhands.local-ipc.response",
    version: response.version,
    requestId: response.requestId,
    nonce: response.nonce,
    issuedAtMs: response.issuedAtMs,
    bodyDigest: response.bodyDigest
  });
}

export function canonicalIpcBody(body: unknown): string {
  return canonicalJson(IpcJsonValueSchema.parse(body));
}
