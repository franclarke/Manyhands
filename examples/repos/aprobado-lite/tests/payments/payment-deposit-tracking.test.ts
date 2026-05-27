import {
  calculateDepositStatus,
  recordDeposit
} from "../../src/payments/deposits/deposit-service";

export function paymentDepositTrackingFixture(): boolean {
  const deposit = recordDeposit({
    quoteId: "quote-1",
    amountCents: 5000,
    recordedAt: "2099-01-01T00:00:00.000Z"
  });

  return calculateDepositStatus(10000, [deposit]) === "partial";
}
