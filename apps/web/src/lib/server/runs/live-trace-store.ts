/**
 * TraceStore decorator that mirrors every appended engine trace into the live
 * UI channels: run-model events (agent-first workspace) and the legacy SSE
 * stream events the run page header consumes.
 */
import {
  type TraceEvent,
  type TraceEventInput,
  type TraceEventType,
  type TraceStore
} from "@manyhands/trace-store";
import { publishRunEvent } from "./event-bus";
import { publishRunModelEvent } from "./run-model-event-log";
import { runModelEventsFromTrace } from "./run-model-trace-adapter";

export class LiveExecutionTraceStore implements TraceStore {
  private readonly delegate: TraceStore;
  private readonly runId: string;
  private readonly defaultModel: string;
  private readonly startedTaskIds = new Set<string>();

  constructor(delegate: TraceStore, runId: string, defaultModel: string) {
    this.delegate = delegate;
    this.runId = runId;
    this.defaultModel = defaultModel;
  }

  append(event: TraceEventInput): TraceEvent {
    const traceEvent = this.delegate.append(event);
    for (const runEvent of runModelEventsFromTrace(traceEvent, {
      runId: this.runId,
      defaultModel: this.defaultModel
    })) {
      publishRunModelEvent(this.runId, runEvent);
    }
    this.publishLiveEvent(traceEvent);
    return traceEvent;
  }

  list(): TraceEvent[] {
    return this.delegate.list();
  }

  findByType(type: TraceEventType): TraceEvent[] {
    return this.delegate.findByType(type);
  }

  findByTask(taskId: string): TraceEvent[] {
    return this.delegate.findByTask(taskId);
  }

  clear(): void {
    this.startedTaskIds.clear();
    this.delegate.clear();
  }

  hasPublishedStart(taskId: string): boolean {
    return this.startedTaskIds.has(taskId);
  }

  private publishLiveEvent(event: TraceEvent): void {
    if (event.taskId === undefined) {
      return;
    }

    if (event.type === "agent_started" || event.type === "integration_started") {
      if (this.startedTaskIds.has(event.taskId)) {
        return;
      }
      this.startedTaskIds.add(event.taskId);
      publishRunEvent(this.runId, {
        kind: "agent.run.started",
        taskId: event.taskId,
        at: event.timestamp
      });
    }
  }
}
