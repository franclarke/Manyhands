import { TaskContractBundleSchema, type TaskContractBundle } from "@manyhands/contracts";
import { foldRun, type RunEvent as CoordinatorRunEvent, type RunProjection } from "@manyhands/run-coordinator";
import { GraphRevisionSchema, type GraphRevision, type TaskNodeV2 } from "@manyhands/task-graph";

import type { NodeExecutionStatus, RunEvent, RunModel, RunNodeView, RunSeed } from "./types";

export function buildRunModel(seed: RunSeed, inputEvents: readonly RunEvent[]): RunModel {
  const events = uniqueOrderedEvents(inputEvents);
  const projection = foldProjection(events);
  const compiled = latestEvent(events, "graph.compiled");
  const compiledGraph = parseGraph(compiled?.payload.graph);
  const provisional = compiledGraph === null ? buildProvisionalGraph(seed, events) : null;
  const graph = compiledGraph ?? provisional?.graph ?? null;
  const contracts = parseContracts(compiled?.payload.contracts);
  const nodes = graph === null ? [] : buildNodeViews(graph, projection, provisional?.layoutByNodeId, provisional !== null);
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
    graphPhase: compiledGraph !== null ? "compiled" : provisional !== null ? "provisional" : null,
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

function buildNodeViews(graph: GraphRevision, projection: RunProjection | null, layoutByNodeId?: ReadonlyMap<string, RunNodeView["layout"]>, provisional = false): RunNodeView[] {
  const own = Object.values(graph.nodes).map((node) => ({
    ...nodeView(node, projection),
    ...(provisional && node.id === graph.rootId ? { status: "running" as const } : {}),
    ...(layoutByNodeId?.get(node.id) !== undefined ? { layout: layoutByNodeId.get(node.id) } : {})
  }));
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

function buildProvisionalGraph(seed: RunSeed, events: readonly RunEvent[]): { graph: GraphRevision; layoutByNodeId: Map<string, RunNodeView["layout"]> } | null {
  const started = [...events].reverse().find((event) => event.type === "planning.attempt_started");
  const attempt = typeof started?.payload.attempt === "number" ? started.payload.attempt : undefined;
  const discoveries = events.filter((event) => event.type === "planning.node_discovered" && (attempt === undefined || event.payload.attempt === attempt));
  if (events.length === 0) return null;
  const layoutByNodeId = new Map<string, RunNodeView["layout"]>();
  const nodes: GraphRevision["nodes"] = {};
  for (const event of discoveries) {
    const candidate = event.payload.node;
    if (!isRecord(candidate) || typeof candidate.nodeId !== "string" || typeof candidate.title !== "string" || typeof candidate.objective !== "string") continue;
    const parentNodeId = typeof candidate.parentNodeId === "string" ? candidate.parentNodeId : null;
    nodes[candidate.nodeId] = {
      id: candidate.nodeId,
      parentId: parentNodeId,
      kind: parentNodeId === null ? "root" : candidate.kind === "composite" ? "composite" : "leaf",
      title: candidate.title,
      goal: candidate.objective
    };
    if (typeof candidate.siblingIndex === "number" && typeof candidate.siblingCount === "number") {
      layoutByNodeId.set(candidate.nodeId, {
        depth: provisionalDepth(candidate.nodeId, discoveries),
        siblingIndex: candidate.siblingIndex,
        siblingCount: candidate.siblingCount
      });
    }
  }
  let rootId = Object.values(nodes).find((node) => node.parentId === null)?.id;
  if (rootId === undefined) {
    rootId = `planning-root:${seed.id}`;
    nodes[rootId] = { id: rootId, parentId: null, kind: "root", title: "Diseñando la solución", goal: seed.goal };
    layoutByNodeId.set(rootId, { depth: 0, siblingIndex: 0, siblingCount: 1 });
  }
  const inspected = latestEvent(events, "repository.inspected");
  const snapshotId = typeof inspected?.payload.snapshotId === "string" ? inspected.payload.snapshotId : "planning";
  return {
    graph: {
      schemaVersion: 2,
      graphId: `planning:${seed.id}`,
      revision: 1,
      rootId,
      baseCommit: "planning",
      repositorySnapshotId: snapshotId,
      nodes,
      artifactRequirements: [],
      seamBindings: [],
      conflictConstraints: [],
      legacyOrderingConstraints: [],
      createdAt: events[0]?.at ?? new Date(0).toISOString()
    },
    layoutByNodeId
  };
}

function provisionalDepth(nodeId: string, discoveries: readonly RunEvent[]): number {
  const parents = new Map<string, string | null>();
  for (const event of discoveries) {
    const node = event.payload.node;
    if (isRecord(node) && typeof node.nodeId === "string") parents.set(node.nodeId, typeof node.parentNodeId === "string" ? node.parentNodeId : null);
  }
  let depth = 0;
  let current = parents.get(nodeId) ?? null;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    depth += 1;
    current = parents.get(current) ?? null;
  }
  return depth;
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
