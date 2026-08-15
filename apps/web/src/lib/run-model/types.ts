import type { TaskContractBundle } from "@manyhands/contracts";
import type { RunLifecycle, RunProjection } from "@manyhands/run-coordinator";

import type { RunGraphNodeView, RunGraphView } from "@/lib/run-model/graph-view";

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

export interface RunNodeView extends RunGraphNodeView {
  status: NodeExecutionStatus;
  integrationStatus?: "running" | "completed" | "failed" | "decision_required" | undefined;
  attemptId?: string;
  artifactCount: number;
  decisionCount: number;
  layout?: { depth: number; siblingIndex: number; siblingCount: number } | undefined;
}

export interface RunModel {
  run: RunSeed;
  projection: RunProjection | null;
  graph: RunGraphView | null;
  graphPhase: "provisional" | "compiled" | null;
  contracts: TaskContractBundle[];
  nodes: RunNodeView[];
  events: RunEvent[];
  evidenceMatrices: Array<Record<string, unknown>>;
}

export interface RunFixture {
  seed: RunSeed;
  events: RunEvent[];
  milestones: FixtureMilestone[];
  intervalMs?: number;
}

export interface FixtureMilestone {
  id: string;
  title: string;
  description: string;
  /** Number of events included when this narrative moment is displayed. */
  eventIndex: number;
}
