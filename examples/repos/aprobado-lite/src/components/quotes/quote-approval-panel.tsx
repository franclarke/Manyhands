import type { QuoteApprovalResult } from "../../quotes/approval/approval-service";

export interface QuoteApprovalPanelProps {
  quoteId: string;
  result?: QuoteApprovalResult;
}

export function QuoteApprovalPanel(props: QuoteApprovalPanelProps): string {
  if (props.result) {
    return `Quote ${props.result.quoteId} was ${props.result.decision}`;
  }

  return `Approve or reject quote ${props.quoteId}`;
}
