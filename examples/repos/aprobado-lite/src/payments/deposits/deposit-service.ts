import {
  createDepositRecord,
  type DepositRecord
} from "./deposit-record";

export type DepositStatus = "none" | "partial" | "complete";

export function recordDeposit(input: DepositRecord): DepositRecord {
  return createDepositRecord(input);
}

export function calculateDepositStatus(totalCents: number, deposits: DepositRecord[]): DepositStatus {
  const paid = deposits.reduce((sum, deposit) => sum + deposit.amountCents, 0);

  if (paid <= 0) {
    return "none";
  }

  return paid >= totalCents ? "complete" : "partial";
}
