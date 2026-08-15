import { createHash } from "node:crypto";

import { describeRecoveryDiagnostic, type RecoveryDiagnostic } from "@manyhands/contracts";

/**
 * A delivery that could not proceed, carrying the evidence an operator needs.
 *
 * The transaction used to reject with prose, so a refusal reached the journal
 * as "the delivery target changed" — a sentence naming neither the ref nor
 * either OID. The message still reads as one line, but the diagnostic travels
 * with it so a caller can branch on the situation instead of matching strings.
 */
export class DeliveryRecoveryError extends Error {
  constructor(readonly diagnostic: RecoveryDiagnostic) {
    super(describeRecoveryDiagnostic(diagnostic));
    this.name = "DeliveryRecoveryError";
  }
}

export interface TransactionalDeliveryApproval {
  manifestId: string;
  finalSha: string;
  targetBranch: string;
  targetHead: string;
  targetFingerprint: string;
  actor: string;
  idempotencyKey: string;
}

export interface DeliveryTargetSnapshot {
  branch: string;
  head: string;
  fingerprint: string;
  clean: boolean;
}

export interface TransactionalDeliveryReceipt {
  receiptId: string;
  requestFingerprint: string;
  manifestId: string;
  finalSha: string;
  targetBranch: string;
  targetHeadBefore: string;
  targetHeadAfter: string;
  disposition: "delivered";
  confirmed: true;
}

export interface DeliveryClaim {
  requestFingerprint: string;
  receipt?: TransactionalDeliveryReceipt;
}

export interface TransactionalPublisherOptions {
  validate?(approval: TransactionalDeliveryApproval): Promise<void>;
  journal: {
    claim(idempotencyKey: string, requestFingerprint: string): Promise<DeliveryClaim>;
    complete(idempotencyKey: string, receipt: TransactionalDeliveryReceipt): Promise<void>;
  };
  repository: {
    inspect(): Promise<DeliveryTargetSnapshot>;
    recover(approval: TransactionalDeliveryApproval): Promise<TransactionalDeliveryReceipt | undefined>;
    publish(approval: TransactionalDeliveryApproval): Promise<TransactionalDeliveryReceipt>;
  };
}

export function deliveryRequestFingerprint(approval: TransactionalDeliveryApproval): string {
  return createHash("sha256").update(JSON.stringify([
    approval.manifestId, approval.finalSha, approval.targetBranch, approval.targetHead,
    approval.targetFingerprint, approval.actor, approval.idempotencyKey
  ])).digest("hex");
}

/** Transaction boundary around an idempotent repository publisher. */
export class TransactionalDeliveryPublisher {
  constructor(private readonly options: TransactionalPublisherOptions) {}

  async publish(approval: TransactionalDeliveryApproval): Promise<TransactionalDeliveryReceipt> {
    await this.options.validate?.(approval);
    const fingerprint = deliveryRequestFingerprint(approval);
    const claim = await this.options.journal.claim(approval.idempotencyKey, fingerprint);
    if (claim.requestFingerprint !== fingerprint) {
      throw new Error("The idempotency key belongs to a different delivery request.");
    }
    if (claim.receipt !== undefined) return claim.receipt;

    const recovered = await this.options.repository.recover(approval);
    if (recovered !== undefined) {
      this.assertReceipt(recovered, approval, fingerprint);
      await this.options.journal.complete(approval.idempotencyKey, recovered);
      return recovered;
    }

    await this.options.validate?.(approval);
    const target = await this.options.repository.inspect();
    if (target.branch !== approval.targetBranch || target.head !== approval.targetHead || target.fingerprint !== approval.targetFingerprint) {
      throw new Error("The delivery target changed after approval; nothing was published.");
    }
    if (!target.clean) throw new Error("The delivery target is dirty; nothing was published.");

    const receipt = await this.options.repository.publish(approval);
    this.assertReceipt(receipt, approval, fingerprint);
    await this.options.journal.complete(approval.idempotencyKey, receipt);
    return receipt;
  }

  private assertReceipt(receipt: TransactionalDeliveryReceipt, approval: TransactionalDeliveryApproval, fingerprint: string): void {
    if (!receipt.confirmed || receipt.disposition !== "delivered" || receipt.requestFingerprint !== fingerprint || receipt.manifestId !== approval.manifestId || receipt.finalSha !== approval.finalSha || receipt.targetBranch !== approval.targetBranch || receipt.targetHeadBefore !== approval.targetHead) {
      throw new Error("Delivery receipt does not confirm the approved request.");
    }
  }
}
