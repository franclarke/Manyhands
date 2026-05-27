import { createPublicProposalLink } from "../../src/proposals/public-link";
import { loadPublicProposalSummary } from "../../src/proposals/public-proposal-view";

export function publicProposalLinkFixture(): boolean {
  const link = createPublicProposalLink("proposal-1");
  const summary = loadPublicProposalSummary(link);
  return summary.proposalId === "proposal-1";
}
