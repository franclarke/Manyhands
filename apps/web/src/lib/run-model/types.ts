import type { TaskContractBundle } from "@manyhands/contracts";
import type { RunLifecycle, RunProjection } from "@manyhands/run-coordinator";
import type { GraphRevision, TaskNodeV2 } from "@manyhands/task-graph";

export interface RunEvent {
  eventId: string;
  seq: number;
  at: string;
  runId: string;
  actor: "system" | "operator";
  type: string;
  payload: Record<string, unknown>;
}

export interface RunSeed {
  id: string;
  title: string;
  goal: string;
  lifecycle: RunLifecycle;
  eventSequence: number;
}

export type NodeExecutionStatus = "pending" | "ready" | "running" | "waiting" | "succeeded" | "failed" | "stale";

export interface RunNodeView extends TaskNodeV2 {
  status: NodeExecutionStatus;
  attemptId?: string;
  artifactCount: number;
  decisionCount: number;
}

export interface RunModel {
  run: RunSeed;
  projection: RunProjection | null;
  graph: GraphRevision | null;
  contracts: TaskContractBundle[];
  nodes: RunNodeView[];
  events: RunEvent[];
  evidenceMatrices: Array<Record<string, unknown>>;
}

export interface RunFixture {
  seed: RunSeed;
  events: RunEvent[];
  intervalMs?: number;
}
