import type { PublicProposalSummary } from "../../../proposals/public-proposal-view";

export interface PublicProposalPageProps {
  summary?: PublicProposalSummary;
}

export function PublicProposalPage(props: PublicProposalPageProps): string {
  if (!props.summary) {
    return "Proposal link is invalid or expired";
  }

  return `Proposal ${props.summary.proposalId}: ${props.summary.totalCents}`;
}
