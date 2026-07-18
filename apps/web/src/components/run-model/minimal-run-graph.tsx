"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { NodeExecutionStatus, RunModel, RunNodeView } from "@/lib/run-model/types";

interface RunGraphCanvasProps {
  model: RunModel;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

interface TaskCardData extends Record<string, unknown> {
  node: RunNodeView;
  selected: boolean;
}

const nodeTypes: NodeTypes = { taskCard: TaskCard };

export function RunGraphCanvas(props: RunGraphCanvasProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <RunGraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function RunGraphCanvasInner({ model, selectedNodeId, onSelectNode }: RunGraphCanvasProps): React.ReactElement {
  const flow = useReactFlow();
  const framed = useRef(false);
  const { nodes, edges } = useMemo(() => graphElements(model, selectedNodeId), [model, selectedNodeId]);

  useEffect(() => {
    if (framed.current || nodes.length === 0) return;
    const root = nodes.find((node) => node.id === model.graph?.rootId) ?? nodes[0]!;
    const timer = window.setTimeout(() => {
      if (framed.current) return;
      framed.current = true;
      void flow.setCenter(root.position.x + 115, root.position.y + 55, { zoom: 0.85, duration: 450 });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [flow, model.graph?.rootId, nodes]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center text-center text-sm text-[var(--color-text-muted)]">
        <div><span className="mb-2 block text-2xl">◇</span>Preparando el primer nodo…</div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onPaneClick={() => onSelectNode(null)}
      onNodeClick={(_event, node) => onSelectNode(node.id)}
      minZoom={0.25}
      maxZoom={1.8}
      defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-border)" />
      <MiniMap pannable zoomable nodeColor={(node) => statusColor((node.data as TaskCardData).node.status)} />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

function TaskCard({ data }: NodeProps<Node<TaskCardData, "taskCard">>): React.ReactElement {
  const { node, selected } = data;
  return (
    <div
      className="relative w-[230px] rounded-xl border bg-[var(--color-surface-raised)] px-4 py-3 shadow-sm transition-[border-color,box-shadow,transform] duration-300"
      style={{
        borderColor: selected ? "var(--color-accent)" : statusColor(node.status),
        boxShadow: selected ? "0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent)" : undefined,
        animation: "mh-node-enter 360ms cubic-bezier(.2,.8,.2,1) both"
      }}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-[var(--color-text-subtle)]" />
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">{node.kind}</span>
        <span className="flex items-center gap-1.5 text-eyebrow font-medium uppercase tracking-wide" style={{ color: statusColor(node.status) }}>
          <span className={node.status === "running" ? "h-1.5 w-1.5 animate-pulse rounded-full bg-current" : "h-1.5 w-1.5 rounded-full bg-current"} />
          {statusLabel(node.status)}
        </span>
      </div>
      <strong className="block text-label leading-5 text-[var(--color-text)]">{node.title}</strong>
      <p className="mt-1 line-clamp-2 text-micro leading-4 text-[var(--color-text-muted)]">{node.goal}</p>
      {(node.artifactCount > 0 || node.decisionCount > 0) ? (
        <div className="mt-2 flex gap-2 text-eyebrow text-[var(--color-text-subtle)]">
          {node.artifactCount > 0 ? <span>{node.artifactCount} artefacto{node.artifactCount === 1 ? "" : "s"}</span> : null}
          {node.decisionCount > 0 ? <span>{node.decisionCount} decisión</span> : null}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-[var(--color-text-subtle)]" />
    </div>
  );
}

function graphElements(model: RunModel, selectedNodeId: string | null): { nodes: Array<Node<TaskCardData, "taskCard">>; edges: Edge[] } {
  if (model.graph === null) return { nodes: [], edges: [] };
  const positions = model.graphPhase === "provisional"
    ? stablePlanningPositions(model.nodes)
    : compiledPositions(model.graph.rootId, model.nodes);
  const nodes: Array<Node<TaskCardData, "taskCard">> = model.nodes.map((node) => ({
    id: node.id,
    type: "taskCard",
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { node, selected: selectedNodeId === node.id }
  }));
  const edges: Edge[] = [];
  for (const node of model.nodes) {
    if (node.parentId === null) continue;
    edges.push({
      id: `hierarchy:${node.parentId}:${node.id}`,
      source: node.parentId,
      target: node.id,
      type: "smoothstep",
      style: { stroke: "var(--color-border-strong)", strokeWidth: 1.2 }
    });
  }
  for (const relation of model.graph.artifactRequirements) {
    edges.push({
      id: `artifact:${relation.id}`,
      source: relation.producerNodeId,
      target: relation.consumerNodeId,
      type: "smoothstep",
      animated: true,
      label: "artefacto",
      style: { stroke: "var(--color-accent)", strokeWidth: 2 }
    });
  }
  for (const relation of model.graph.seamBindings) {
    edges.push({
      id: `seam:${relation.id}`,
      source: relation.producerNodeId,
      target: relation.consumerNodeId,
      type: "bezier",
      label: "contrato",
      style: { stroke: "var(--status-review-fg)", strokeDasharray: "5 4", strokeWidth: 1.5 }
    });
  }
  for (const relation of model.graph.conflictConstraints) {
    edges.push({
      id: `conflict:${relation.id}`,
      source: relation.leftNodeId,
      target: relation.rightNodeId,
      type: "straight",
      label: "conflicto",
      style: { stroke: "var(--error)", strokeDasharray: "2 5", strokeWidth: 1.5 }
    });
  }
  return { nodes, edges };
}

function stablePlanningPositions(nodes: readonly RunNodeView[]): Map<string, { x: number; y: number }> {
  const output = new Map<string, { x: number; y: number }>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const positionFor = (node: RunNodeView): { x: number; y: number } => {
    const cached = output.get(node.id);
    if (cached !== undefined) return cached;
    const layout = node.layout ?? { depth: 0, siblingIndex: 0, siblingCount: 1 };
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    const parentPosition = parent === undefined ? { x: 0, y: -180 } : positionFor(parent);
    const spacing = Math.max(270, 420 - layout.depth * 45);
    const position = {
      x: parentPosition.x + (layout.siblingIndex - (layout.siblingCount - 1) / 2) * spacing,
      y: layout.depth * 180
    };
    output.set(node.id, position);
    return position;
  };
  for (const node of nodes) positionFor(node);
  return output;
}

function compiledPositions(rootId: string, nodes: readonly RunNodeView[]): Map<string, { x: number; y: number }> {
  const output = new Map<string, { x: number; y: number }>();
  for (const [depth, level] of hierarchyLevels(rootId, nodes).entries()) {
    const width = Math.max(0, (level.length - 1) * 285);
    level.forEach((node, index) => output.set(node.id, { x: index * 285 - width / 2, y: depth * 180 }));
  }
  return output;
}

function hierarchyLevels(rootId: string, nodes: readonly RunNodeView[]): RunNodeView[][] {
  const byParent = new Map<string | null, RunNodeView[]>();
  for (const node of nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  const levels: RunNodeView[][] = [];
  let frontier = nodes.filter((node) => node.id === rootId);
  while (frontier.length > 0) {
    levels.push(frontier);
    frontier = frontier.flatMap((node) => byParent.get(node.id) ?? []);
  }
  return levels;
}

function statusColor(status: NodeExecutionStatus): string {
  switch (status) {
    case "ready": return "var(--status-ready-fg)";
    case "running": return "var(--status-running-fg)";
    case "waiting": return "var(--status-review-fg)";
    case "succeeded": return "var(--status-completed-fg)";
    case "failed": return "var(--status-failed-fg)";
    case "stale": return "var(--color-text-subtle)";
    default: return "var(--color-border-strong)";
  }
}

function statusLabel(status: NodeExecutionStatus): string {
  const labels: Record<NodeExecutionStatus, string> = {
    pending: "pendiente",
    ready: "listo",
    running: "ejecutando",
    waiting: "decisión",
    succeeded: "completo",
    failed: "falló",
    stale: "obsoleto"
  };
  return labels[status];
}
