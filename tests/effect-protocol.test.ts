import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EffectIntentSchema,
  PhysicalEffectReceiptSchema,
  buildEffectIntent,
  buildPhysicalEffectReceipt,
  replayPhysicalEffectReceipts,
  validateEffectIntentIdentity,
  validatePhysicalEffectReceiptBinding,
  validatePhysicalEffectReceiptIdentity,
  type DigestHasher
} from "@manyhands/contracts";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("durable effect protocol", () => {
  it("builds a strict intent whose stable effectId identifies every dispatch input", () => {
    const first = buildEffectIntent(effectIntentMaterial(), sha256);
    const equivalent = buildEffectIntent({ ...effectIntentMaterial() }, sha256);

    expect(equivalent).toEqual(first);
    expect(EffectIntentSchema.parse(first)).toEqual(first);
    expect(EffectIntentSchema.safeParse({ ...first, runtimeStatus: "dispatched" }).success).toBe(false);
    expect(validateEffectIntentIdentity(first, sha256)).toEqual({ ok: true, issues: [] });
    expect(validateEffectIntentIdentity({ ...first, daemonEpoch: "daemon:epoch-2" }, sha256).issues)
      .toContainEqual(expect.objectContaining({ code: "effect_id_mismatch" }));
  });

  it("builds immutable started and terminal receipts with distinct physical identities", () => {
    const intent = buildEffectIntent(effectIntentMaterial(), sha256);
    const started = buildPhysicalEffectReceipt(receiptMaterial(intent.effectId), sha256);
    const succeeded = buildPhysicalEffectReceipt({
      ...receiptMaterial(intent.effectId),
      observation: "succeeded",
      resultDigest: "sha256:process-result",
      observedAt: "2026-08-12T12:00:02.000Z"
    }, sha256);

    expect(started.receiptId).not.toBe(succeeded.receiptId);
    expect(PhysicalEffectReceiptSchema.parse(started)).toEqual(started);
    expect(PhysicalEffectReceiptSchema.safeParse({ ...started, mutableState: "succeeded" }).success).toBe(false);
    expect(validatePhysicalEffectReceiptIdentity(started, sha256)).toEqual({ ok: true, issues: [] });
    expect(validatePhysicalEffectReceiptIdentity({ ...started, observation: "failed" }, sha256).issues)
      .toContainEqual(expect.objectContaining({ code: "receipt_id_mismatch" }));
  });

  it("deduplicates an identical receipt replay and fails closed on receiptId reuse", () => {
    const intent = buildEffectIntent(effectIntentMaterial(), sha256);
    const receipt = buildPhysicalEffectReceipt(receiptMaterial(intent.effectId), sha256);

    expect(replayPhysicalEffectReceipts([receipt, { ...receipt }], sha256)).toEqual({
      ok: true,
      receipts: [receipt],
      identicalReplayReceiptIds: [receipt.receiptId],
      issues: []
    });

    const corrupted = replayPhysicalEffectReceipts([
      receipt,
      { ...receipt, observation: "failed" }
    ], sha256);
    expect(corrupted.ok).toBe(false);
    expect(corrupted.issues).toContainEqual(expect.objectContaining({
      code: "receipt_id_conflict",
      receiptId: receipt.receiptId
    }));
  });

  it("binds a receipt to immutable effect inputs while allowing recovery under a successor epoch", () => {
    const intent = buildEffectIntent(effectIntentMaterial(), sha256);
    const receipt = buildPhysicalEffectReceipt(receiptMaterial(intent.effectId), sha256);
    expect(validatePhysicalEffectReceiptBinding(receipt, intent, sha256)).toEqual({ ok: true, issues: [] });

    const mismatches = [
      {
        receipt: buildPhysicalEffectReceipt({ ...receiptMaterial(intent.effectId), effectId: "sha256:other-effect" }, sha256),
        code: "effect_binding_mismatch"
      },
      {
        receipt: buildPhysicalEffectReceipt({ ...receiptMaterial(intent.effectId), inputDigest: "sha256:other-input" }, sha256),
        code: "input_digest_mismatch"
      }
    ] as const;

    for (const mismatch of mismatches) {
      expect(validatePhysicalEffectReceiptBinding(mismatch.receipt, intent, sha256).issues)
        .toContainEqual(expect.objectContaining({ code: mismatch.code }));
    }

    const recoveredObservation = buildPhysicalEffectReceipt({
      ...receiptMaterial(intent.effectId),
      daemonEpoch: "daemon:epoch-2"
    }, sha256);
    expect(validatePhysicalEffectReceiptBinding(recoveredObservation, intent, sha256))
      .toEqual({ ok: true, issues: [] });
  });
});

function effectIntentMaterial() {
  return {
    runId: "run:booking",
    attemptId: "attempt:booking:1",
    kind: "process_spawn" as const,
    inputDigest: "sha256:process-input",
    daemonEpoch: "daemon:epoch-1",
    idempotency: "reconcile_then_repeat" as const,
    requestedAt: "2026-08-12T12:00:00.000Z"
  };
}

function receiptMaterial(effectId: string) {
  return {
    effectId,
    observation: "started" as const,
    inputDigest: "sha256:process-input",
    daemonEpoch: "daemon:epoch-1",
    processIdentity: {
      pid: 4242,
      creationIdentity: "process:created-at-120000",
      supervisorNonce: "nonce:supervisor-1"
    },
    observedAt: "2026-08-12T12:00:01.000Z"
  };
}
