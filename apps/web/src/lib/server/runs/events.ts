import type { RunStatus } from "./schema";

export type RunEventKind =
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

export interface RunEventBase {
  kind: RunEventKind;
  at: string;
}

export interface StatusChangedEvent extends RunEventBase {
  kind: "status.changed";
  status: RunStatus;
}

export interface TitleUpdatedEvent extends RunEventBase {
  kind: "title.updated";
  title: string;
  summary: string;
}

export interface PlanningNodeStartedEvent extends RunEventBase {
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

export interface PlanningNodeStatusEvent extends RunEventBase {
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

export interface PlanningNodeCompletedEvent extends RunEventBase {
  kind: "planning.node.completed";
  nodeId: string;
  decision: "atomic" | "decompose" | "question";
  childIds: string[];
  childNodes?: PlanningNodeChildDraft[];
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

export interface PlanningCliOutputEvent extends RunEventBase {
  kind: "planning.cli.output";
  nodeId: string;
  chunk: string;
  stream: "stdout" | "stderr";
}

export interface PlanningQuestionEvent extends RunEventBase {
  kind: "planning.question";
  nodeId: string;
  question: string;
  options: string[];
}

export interface HeartbeatEvent extends RunEventBase {
  kind: "heartbeat";
}

export type RunEvent =
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

export function serializeForSse(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
