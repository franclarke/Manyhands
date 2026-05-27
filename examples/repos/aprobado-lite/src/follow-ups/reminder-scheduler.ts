import {
  shouldCreateFollowUp,
  type FollowUpCandidate
} from "./reminder-rules";

export interface FollowUpReminder {
  customerId: string;
  dueAt: string;
}

export function buildFollowUpReminders(candidates: FollowUpCandidate[]): FollowUpReminder[] {
  return candidates
    .filter(shouldCreateFollowUp)
    .map((candidate) => ({
      customerId: candidate.customerId,
      dueAt: "2099-01-02T00:00:00.000Z"
    }));
}
