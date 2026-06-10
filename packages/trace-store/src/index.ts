import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema, nowIso } from "@manyhands/shared";
import { z } from "zod";

export const TraceEventTypeSchema = z.union([
  z.literal("feature_loaded"),
  z.literal("decomposition_started"),
  z.literal("graph_created"),
  z.literal("contract_created"),
  z.literal("graph_validated"),
  z.literal("contract_validated"),
  z.literal("repository_index_loaded"),
  z.literal("static_conflict_signals_generated"),
  z.literal("risk_predicted"),
  z.literal("batch_scheduled"),
  z.literal("planning_run_completed"),
  z.literal("planning_run_failed"),
  z.literal("execution_started"),
  z.literal("batch_execution_started"),
  z.literal("task_execution_started"),
  z.literal("mock_worktree_created"),
  z.literal("agent_run_started"),
  z.literal("agent_run_completed"),
  z.literal("agent_run_failed"),
  z.literal("scope_validated"),
  z.literal("batch_execution_completed"),
  z.literal("execution_completed"),
  z.literal("execution_failed"),
  z.literal("human_gate_required"),
  z.literal("human_gate_decision_recorded"),
  z.literal("task_serialized_by_gate"),
  z.literal("task_blocked_by_gate"),
  z.literal("batch_modified_by_gate"),
  z.literal("task_started"),
  z.literal("task_completed"),
  z.literal("task_failed"),
  z.literal("validation_completed"),
  z.literal("human_review_requested"),
  z.literal("dag_patch_appended"),

  // Execution Core events
  z.literal("worktree_created"),
  z.literal("worktree_clean_failed"),
  z.literal("context_packed"),
  z.literal("agent_started"),
  z.literal("executor_started"),
  z.literal("executor_output"),
  z.literal("executor_completed"),
  z.literal("unexpected_commit_detected"),
  z.literal("scope_check_failed"),
  z.literal("scope_advisory"),
  z.literal("validation_started"),
  z.literal("agent_committed"),
  z.literal("integration_started"),
  z.literal("cherry_pick_attempted"),
  z.literal("cherry_pick_conflict"),
  z.literal("executor_repair_started"),
  z.literal("repair_syntax_rejected"),
  z.literal("integration_completed"),
  z.literal("batch_started"),
  z.literal("batch_completed"),
  z.literal("run_completed")
]);

export type TraceEventType = z.infer<typeof TraceEventTypeSchema>;

export const TraceActorSchema = z.union([
  z.literal("system"),
  z.literal("human"),
  z.literal("agent")
]);

export type TraceActor = z.infer<typeof TraceActorSchema>;

export const TraceEventSchema = z.object({
  id: EntityIdSchema,
  type: TraceEventTypeSchema,
  timestamp: IsoTimestampSchema,
  actor: TraceActorSchema,
  planId: EntityIdSchema.optional(),
  taskId: EntityIdSchema.optional(),
  payload: z.record(z.unknown()).default({})
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;

export type TraceEventInput = Omit<TraceEvent, "id" | "timestamp"> &
  Partial<Pick<TraceEvent, "id" | "timestamp">>;

export interface TraceStore {
  append(event: TraceEventInput): TraceEvent;
  list(): TraceEvent[];
  findByType(type: TraceEventType): TraceEvent[];
  findByTask(taskId: string): TraceEvent[];
  clear(): void;
}

export class InMemoryTraceStore implements TraceStore {
  private readonly events: TraceEvent[] = [];

  append(event: TraceEventInput): TraceEvent {
    const nextEvent: TraceEvent = {
      id: event.id ?? `trace-${this.events.length + 1}`,
      timestamp: event.timestamp ?? nowIso(),
      type: event.type,
      actor: event.actor,
      payload: event.payload
    };

    if (event.planId !== undefined) {
      nextEvent.planId = event.planId;
    }

    if (event.taskId !== undefined) {
      nextEvent.taskId = event.taskId;
    }

    const parsed = TraceEventSchema.parse(nextEvent);
    this.events.push(parsed);
    return parsed;
  }

  list(): TraceEvent[] {
    return [...this.events];
  }

  findByType(type: TraceEventType): TraceEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  findByTask(taskId: string): TraceEvent[] {
    NonEmptyStringSchema.parse(taskId);
    return this.events.filter((event) => event.taskId === taskId);
  }

  clear(): void {
    this.events.length = 0;
  }
}
