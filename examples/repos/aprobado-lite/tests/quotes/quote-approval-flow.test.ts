import {
  issueQuoteApprovalLink,
  recordQuoteApprovalDecision
} from "../../src/quotes/approval/approval-service";

export function quoteApprovalFlowFixture(): boolean {
  const token = issueQuoteApprovalLink("quote-1");
  const result = recordQuoteApprovalDecision(token, "approved");
  return result.quoteId === "quote-1" && result.decision === "approved";
}
