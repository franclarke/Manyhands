export type QuoteApprovalDecision = "approved" | "rejected";

export interface QuoteApprovalToken {
  quoteId: string;
  token: string;
  expiresAt: string;
}

export function createQuoteApprovalToken(quoteId: string): QuoteApprovalToken {
  return {
    quoteId,
    token: `quote-${quoteId}-approval-token`,
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
}
