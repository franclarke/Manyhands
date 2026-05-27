import { buildFollowUpReminders } from "../../src/follow-ups/reminder-scheduler";

export function customerFollowUpRemindersFixture(): boolean {
  const reminders = buildFollowUpReminders([
    {
      customerId: "customer-1",
      lastContactAt: "2020-01-01T00:00:00.000Z",
      dismissed: false
    }
  ]);

  return reminders.length === 1;
}
