import { z } from "zod";

export const RunLifecycleSchema = z.enum([
  "planning",
  "needs_approval",
  "running",
  "waiting_for_input",
  "paused",
  "cancelling",
  "interrupted",
  "result_ready",
  "delivering",
  "completed",
  "failed"
]);

export type RunLifecycle = z.infer<typeof RunLifecycleSchema>;

export const LEGAL_LIFECYCLE_TRANSITIONS: Readonly<Record<RunLifecycle, readonly RunLifecycle[]>> = {
  planning: ["needs_approval", "cancelling", "failed"],
  needs_approval: ["planning", "running", "cancelling", "failed"],
  running: ["needs_approval", "waiting_for_input", "paused", "cancelling", "result_ready", "failed"],
  waiting_for_input: ["running", "paused", "cancelling", "failed"],
  paused: ["running", "waiting_for_input", "cancelling", "failed"],
  cancelling: ["interrupted", "failed"],
  interrupted: ["running", "cancelling", "failed"],
  result_ready: ["delivering", "cancelling", "failed"],
  delivering: ["result_ready", "cancelling", "completed", "failed"],
  completed: [],
  // A failed execution can be resumed only through the explicit restart
  // command. This preserves its journalled failure while allowing the actor to
  // close any unfinished attempt and continue the still-valid graph.
  failed: ["running"]
};

export function assertLifecycleTransition(from: RunLifecycle, to: RunLifecycle): void {
  if (from === to) return;
  if (!LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal lifecycle transition from ${from} to ${to}.`);
  }
}
