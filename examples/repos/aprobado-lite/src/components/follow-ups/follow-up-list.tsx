import type { FollowUpReminder } from "../../follow-ups/reminder-scheduler";

export interface FollowUpListProps {
  reminders: FollowUpReminder[];
}

export function FollowUpList(props: FollowUpListProps): string {
  return props.reminders.length === 0
    ? "No pending follow-ups"
    : `${props.reminders.length} pending follow-ups`;
}
