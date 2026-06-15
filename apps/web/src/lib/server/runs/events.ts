import type { RunStatus } from "./schema";

export type StreamEventKind =
  | "status.changed"
  | "title.updated"
  | "planning.node.started"
  | "planning.node.status"
  | "planning.node.completed"
  | "node.added"
  | "edge.added"
  | "risk.added"
  | "gate.required"
  | "agent.run.started"
  | "agent.run.completed"
  | "validation.completed"
  | "replay.start"
  | "replay.end"
  | "planning.cli.output"
  | "planning.question"
  | "heartbeat";

export type RiskLevelKey = "low" | "medium" | "high" | "blocking";

export interface StreamEventBase {
  kind: StreamEventKind;
  at: string;
}

export interface StatusChangedEvent extends StreamEventBase {
  kind: "status.changed";
  status: RunStatus;
}

export interface TitleUpdatedEvent extends StreamEventBase {
  kind: "title.updated";
  title: string;
  summary: string;
}

export interface PlanningNodeStartedEvent extends StreamEventBase {
  kind: "planning.node.started";
  nodeId: string;
  parentId?: string;
  title: string;
  goal: string;
  depth: number;
}

export type PlanningNodeState =
  | "pending"
  | "active"
  | "complete"
  | "generating"
  | "generated"
  | "failed"
  | "retrying"
  | "fallback";

export interface PlanningNodeStatusEvent extends StreamEventBase {
  kind: "planning.node.status";
  nodeId: string;
  parentId?: string;
  title: string;
  goal: string;
  depth: number;
  state: PlanningNodeState;
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
  errorKind?: string;
  errorMessage?: string;
}

export interface PlanningNodeChildDraft {
  nodeId: string;
  parentId: string;
  title: string;
  goal: string;
  depth: number;
}

export interface PlanningNodeCompletedEvent extends StreamEventBase {
  kind: "planning.node.completed";
  nodeId: string;
  decision: "atomic" | "decompose" | "question";
  childIds: string[];
  childNodes?: PlanningNodeChildDraft[];
}

export interface NodeAddedEvent extends StreamEventBase {
  kind: "node.added";
  taskId: string;
}

export interface EdgeAddedEvent extends StreamEventBase {
  kind: "edge.added";
  edgeId: string;
}

export interface RiskAddedEvent extends StreamEventBase {
  kind: "risk.added";
  pairKey: string;
  level: RiskLevelKey;
}

export interface GateRequiredEvent extends StreamEventBase {
  kind: "gate.required";
  taskIds: string[];
}

export interface AgentRunStartedEvent extends StreamEventBase {
  kind: "agent.run.started";
  taskId: string;
}

export interface AgentRunCompletedEvent extends StreamEventBase {
  kind: "agent.run.completed";
  taskId: string;
  success: boolean;
}

export interface ValidationCompletedEvent extends StreamEventBase {
  kind: "validation.completed";
  taskId: string;
  passed: boolean;
}

export interface ReplayBoundaryEvent extends StreamEventBase {
  kind: "replay.start" | "replay.end";
}

export interface PlanningCliOutputEvent extends StreamEventBase {
  kind: "planning.cli.output";
  nodeId: string;
  chunk: string;
  stream: "stdout" | "stderr";
}

export interface PlanningQuestionEvent extends StreamEventBase {
  kind: "planning.question";
  nodeId: string;
  question: string;
  options: string[];
}

export interface HeartbeatEvent extends StreamEventBase {
  kind: "heartbeat";
}

export type StreamEvent =
  | StatusChangedEvent
  | TitleUpdatedEvent
  | PlanningNodeStartedEvent
  | PlanningNodeStatusEvent
  | PlanningNodeCompletedEvent
  | NodeAddedEvent
  | EdgeAddedEvent
  | RiskAddedEvent
  | GateRequiredEvent
  | AgentRunStartedEvent
  | AgentRunCompletedEvent
  | ValidationCompletedEvent
  | ReplayBoundaryEvent
  | PlanningCliOutputEvent
  | PlanningQuestionEvent
  | HeartbeatEvent;

export function serializeForSse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
