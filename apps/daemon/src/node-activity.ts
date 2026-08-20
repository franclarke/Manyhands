import path from "node:path";

import { JsonlTraceStore } from "@manyhands/trace-store";

/**
 * What one node's agent is doing, read back from the durable traces.
 *
 * The executor already appends every chunk it receives, but nothing read them,
 * so a running node was a spinner with no content. This is the read side, and
 * it is deliberately a query rather than a stream of its own: the traces are
 * the record, and a reader that reconnects resumes from an index instead of
 * replaying a conversation it already has.
 */
export interface NodeActivityEntry {
  index: number;
  type: string;
  timestamp: string;
  /** The agent's own output. Empty for lifecycle entries that carry no text. */
  text: string;
}

export interface NodeActivityPage {
  entries: NodeActivityEntry[];
  nextIndex: number;
}

export interface NodeActivityQuery {
  stateRoot: string;
  runId: string;
  nodeId: string;
  afterIndex: number;
}

/** The trace types that say what an agent is doing, as opposed to what a run decided. */
const ACTIVITY_TYPES = new Set([
  "executor_started",
  "executor_output",
  "executor_completed",
  "executor_routed",
  "agent_status",
  "agent_started",
  "agent_run_started",
  "agent_run_completed",
  "agent_run_failed"
]);

export function readNodeActivity(query: NodeActivityQuery): NodeActivityPage {
  const store = new JsonlTraceStore({
    runId: query.runId,
    directory: path.join(query.stateRoot, "traces")
  });
  const activity = store.list().filter((event) =>
    event.taskId === query.nodeId && ACTIVITY_TYPES.has(event.type)
  );
  const after = Number.isFinite(query.afterIndex) ? Math.max(0, Math.trunc(query.afterIndex)) : 0;
  const entries = activity.slice(after).map((event, offset) => ({
    index: after + offset + 1,
    type: event.type,
    timestamp: event.timestamp,
    text: chunkText(event.payload)
  }));
  return { entries, nextIndex: activity.length };
}

/**
 * The chunk an executor wrote. The trace schema requires an object payload, and
 * executors spell the text differently depending on the stream they wrap.
 */
function chunkText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["chunk", "text", "message", "output"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}
