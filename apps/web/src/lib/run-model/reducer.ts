import { TaskContractBundleSchema, type TaskContractBundle } from "@manyhands/contracts";
import { foldRun, type RunEvent as CoordinatorRunEvent, type RunProjection } from "@manyhands/run-coordinator";
import { GraphRevisionSchema, type GraphRevision, type TaskNodeV2 } from "@manyhands/task-graph";

import type { NodeExecutionStatus, RunEvent, RunModel, RunNodeView, RunSeed } from "./types";

export function buildRunModel(seed: RunSeed, inputEvents: readonly RunEvent[]): RunModel {
  const events = uniqueOrderedEvents(inputEvents);
  const projection = foldProjection(events);
  const compiled = latestEvent(events, "graph.compiled");
  const graph = parseGraph(compiled?.payload.graph);
  const contracts = parseContracts(compiled?.payload.contracts);
  const nodes = graph === null ? [] : buildNodeViews(graph, projection);
  const evidenceMatrices = events
    .filter((event) => event.type === "evidence.matrix_recorded" || event.type === "validation.completed" || event.type === "integration.completed")
    .flatMap((event) => {
      const matrix = event.payload.matrix;
      return isRecord(matrix) ? [matrix] : [];
    });
  return {
    run: {
      ...seed,
      lifecycle: projection?.lifecycle ?? seed.lifecycle,
      eventSequence: projection?.sequence ?? seed.eventSequence
    },
    projection,
    graph,
    contracts,
    nodes,
    events,
    evidenceMatrices
  };
}

export function reduceRunEvents(seed: RunSeed, events: readonly RunEvent[]): RunModel {
  return buildRunModel(seed, events);
}

function foldProjection(events: readonly RunEvent[]): RunProjection | null {
  if (events.length === 0) return null;
  return foldRun(events.map((event) => ({
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.seq,
    occurredAt: event.at,
    type: event.type,
    payload: event.payload
  })) as CoordinatorRunEvent[]);
}

function parseGraph(value: unknown): GraphRevision | null {
  const parsed = GraphRevisionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseContracts(value: unknown): TaskContractBundle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const parsed = TaskContractBundleSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

function buildNodeViews(graph: GraphRevision, projection: RunProjection | null): RunNodeView[] {
  const own = Object.values(graph.nodes).map((node) => nodeView(node, projection));
  const byId = new Map(own.map((node) => [node.id, node]));
  const children = new Map<string, RunNodeView[]>();
  for (const node of own) {
    if (node.parentId === null) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  const aggregate = (nodeId: string): NodeExecutionStatus => {
    const node = byId.get(nodeId);
    if (node === undefined) return "pending";
    const direct = children.get(nodeId) ?? [];
    if (direct.length === 0) return node.status;
    const statuses = direct.map((child) => aggregate(child.id));
    if (statuses.some((status) => status === "failed")) node.status = "failed";
    else if (statuses.every((status) => status === "succeeded")) node.status = "succeeded";
    else if (statuses.some((status) => status === "running")) node.status = "running";
    else if (statuses.some((status) => status === "waiting")) node.status = "waiting";
    else if (statuses.some((status) => status === "ready")) node.status = "ready";
    return node.status;
  };
  aggregate(graph.rootId);
  return own;
}

function nodeView(node: TaskNodeV2, projection: RunProjection | null): RunNodeView {
  const attempts = projection === null ? [] : Object.values(projection.attempts).filter((attempt) => attempt.nodeId === node.id);
  const latestAttempt = attempts.at(-1);
  const integration = projection === null ? undefined : Object.values(projection.integrations).find((entry) => entry.nodeId === node.id);
  const artifacts = projection === null ? [] : Object.values(projection.adoptedArtifacts).filter((artifact) => artifact.nodeId === node.id);
  const decisions = projection === null ? [] : Object.values(projection.decisions).filter((decision) => decision.status === "pending" && decision.affectedNodeIds.includes(node.id));
  let status: NodeExecutionStatus = "pending";
  if (artifacts.length > 0 || integration?.status === "completed" || latestAttempt?.status === "adopted") status = "succeeded";
  else if (integration?.status === "failed" || latestAttempt?.status === "failed" || latestAttempt?.status === "discarded") status = "failed";
  else if (latestAttempt?.status === "stale") status = "stale";
  else if (integration?.status === "running" || latestAttempt?.status === "running" || latestAttempt?.status === "candidate" || latestAttempt?.status === "validated") status = "running";
  else if (decisions.length > 0) status = "waiting";
  else if (projection?.readiness.readyNodeIds.includes(node.id) === true) status = "ready";
  return {
    ...node,
    status,
    ...(latestAttempt !== undefined ? { attemptId: latestAttempt.attemptId } : {}),
    artifactCount: artifacts.length,
    decisionCount: decisions.length
  };
}

function uniqueOrderedEvents(events: readonly RunEvent[]): RunEvent[] {
  const byId = new Map<string, RunEvent>();
  for (const event of events) byId.set(event.eventId, event);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

function latestEvent(events: readonly RunEvent[], type: string): RunEvent | undefined {
  return [...events].reverse().find((event) => event.type === type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
