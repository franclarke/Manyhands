export interface PublicProposalLink {
  proposalId: string;
  token: string;
  expiresAt: string;
}

export function createPublicProposalLink(proposalId: string): PublicProposalLink {
  return {
    proposalId,
    token: `proposal-${proposalId}-public-token`,
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
}
