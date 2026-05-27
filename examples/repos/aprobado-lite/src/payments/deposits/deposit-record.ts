export interface DepositRecord {
  quoteId: string;
  amountCents: number;
  recordedAt: string;
  note?: string;
}

export function createDepositRecord(input: DepositRecord): DepositRecord {
  if (input.amountCents <= 0) {
    throw new Error("deposit amount must be positive");
  }

  return input;
}
