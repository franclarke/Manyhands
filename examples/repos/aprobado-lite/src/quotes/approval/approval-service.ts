import {
  createQuoteApprovalToken,
  type QuoteApprovalDecision,
  type QuoteApprovalToken
} from "./approval-token";

export interface QuoteApprovalResult {
  quoteId: string;
  decision: QuoteApprovalDecision;
  reason?: string;
}

export function issueQuoteApprovalLink(quoteId: string): QuoteApprovalToken {
  return createQuoteApprovalToken(quoteId);
}

export function recordQuoteApprovalDecision(
  token: QuoteApprovalToken,
  decision: QuoteApprovalDecision,
  reason?: string
): QuoteApprovalResult {
  return {
    quoteId: token.quoteId,
    decision,
    ...(reason ? { reason } : {})
  };
}
