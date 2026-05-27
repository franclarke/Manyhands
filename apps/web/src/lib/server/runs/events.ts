import type { RunStatus } from "./schema";

export type RunEventKind =
  | "status.changed"
  | "node.added"
  | "edge.added"
  | "risk.added"
  | "gate.required"
  | "agent.run.started"
  | "agent.run.completed"
  | "validation.completed"
  | "replay.start"
  | "replay.end"
  | "heartbeat";

export type RiskLevelKey = "low" | "medium" | "high" | "blocking";

export interface RunEventBase {
  kind: RunEventKind;
  at: string;
}

export interface StatusChangedEvent extends RunEventBase {
  kind: "status.changed";
  status: RunStatus;
}

export interface NodeAddedEvent extends RunEventBase {
  kind: "node.added";
  taskId: string;
}

export interface EdgeAddedEvent extends RunEventBase {
  kind: "edge.added";
  edgeId: string;
}

export interface RiskAddedEvent extends RunEventBase {
  kind: "risk.added";
  pairKey: string;
  level: RiskLevelKey;
}

export interface GateRequiredEvent extends RunEventBase {
  kind: "gate.required";
  taskIds: string[];
}

export interface AgentRunStartedEvent extends RunEventBase {
  kind: "agent.run.started";
  taskId: string;
}

export interface AgentRunCompletedEvent extends RunEventBase {
  kind: "agent.run.completed";
  taskId: string;
  success: boolean;
}

export interface ValidationCompletedEvent extends RunEventBase {
  kind: "validation.completed";
  taskId: string;
  passed: boolean;
}

export interface ReplayBoundaryEvent extends RunEventBase {
  kind: "replay.start" | "replay.end";
}

export interface HeartbeatEvent extends RunEventBase {
  kind: "heartbeat";
}

export type RunEvent =
  | StatusChangedEvent
  | NodeAddedEvent
  | EdgeAddedEvent
  | RiskAddedEvent
  | GateRequiredEvent
  | AgentRunStartedEvent
  | AgentRunCompletedEvent
  | ValidationCompletedEvent
  | ReplayBoundaryEvent
  | HeartbeatEvent;

export function serializeForSse(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
