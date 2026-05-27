export interface FollowUpCandidate {
  customerId: string;
  lastContactAt: string;
  dismissed: boolean;
}

export function shouldCreateFollowUp(candidate: FollowUpCandidate): boolean {
  return !candidate.dismissed && candidate.lastContactAt < "2099-01-01T00:00:00.000Z";
}
