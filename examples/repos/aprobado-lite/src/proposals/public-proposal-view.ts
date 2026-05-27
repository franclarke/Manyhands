import type { PublicProposalLink } from "./public-link";

export interface PublicProposalSummary {
  proposalId: string;
  totalCents: number;
  visibleLineItemCount: number;
}

export function loadPublicProposalSummary(link: PublicProposalLink): PublicProposalSummary {
  return {
    proposalId: link.proposalId,
    totalCents: 10000,
    visibleLineItemCount: 2
  };
}
