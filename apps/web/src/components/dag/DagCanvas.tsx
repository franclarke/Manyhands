"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutByDepth, type PhaseColumn } from "@/lib/dag-layout";
import type {
  GraphEdgeView,
  GraphNodeView,
  GraphRiskLevel,
  RunGraphViewModel
} from "@/lib/graph-view-model";
import { TaskNodeCard, type TaskNodeData } from "./TaskNodeCard";

interface DagCanvasProps {
  graph: RunGraphViewModel;
  selectedTaskId: string | null;
  highlightTaskIds: ReadonlySet<string> | null;
  onSelectTask: (taskId: string | null) => void;
}

const nodeTypes: NodeTypes = {
  taskCard: TaskNodeCard,
  phaseHeader: PhaseHeaderNode
};

const RISK_EDGE_COLOR: Record<GraphRiskLevel, string> = {
  low:      "var(--risk-low)",
  medium:   "var(--risk-medium)",
  high:     "var(--risk-high)",
  blocking: "var(--risk-blocking)"
};

export function DagCanvas(props: DagCanvasProps): React.ReactElement {
  const { graph, selectedTaskId, highlightTaskIds, onSelectTask } = props;

  const dependencyCountByTaskId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      if (edge.kind === "dependency") {
        counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
        counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
      }
    }
    return counts;
  }, [graph.edges]);

  const { nodes, edges } = useMemo(
    () => buildFlow(graph, selectedTaskId, highlightTaskIds, dependencyCountByTaskId),
    [graph, selectedTaskId, highlightTaskIds, dependencyCountByTaskId]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18, includeHiddenNodes: false }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.25}
      maxZoom={1.6}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnDrag
      selectionOnDrag={false}
      onNodeClick={(_event, node) => {
        if (node.type === "taskCard") {
          onSelectTask(node.id);
        }
      }}
      onPaneClick={() => onSelectTask(null)}
      style={{ background: "transparent", width: "100%", height: "100%" }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(229,222,204,0.045)" />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(26,25,21,0.65)"
        nodeColor={(node) => miniMapNodeColor(node.data as TaskNodeData, node.type)}
        nodeStrokeColor="var(--border)"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function buildFlow(
  graph: RunGraphViewModel,
  selectedTaskId: string | null,
  highlightTaskIds: ReadonlySet<string> | null,
  dependencyCountByTaskId: ReadonlyMap<string, number>
): { nodes: Node[]; edges: Edge[] } {
  const layout = layoutByDepth(graph.nodes);
  const isFiltered = highlightTaskIds !== null;

  const headerNodes: Node[] = layout.columns.map((column) => ({
    id: `phase-${column.depth}`,
    type: "phaseHeader",
    position: { x: column.x, y: 8 },
    data: phaseHeaderData(column),
    draggable: false,
    selectable: false,
    connectable: false,
    style: { pointerEvents: "none" }
  }));

  const taskNodes: Node[] = graph.nodes.map((node) => {
    const position = layout.positions.get(node.id) ?? { x: 0, y: 0, id: node.id };
    const dimmed = isFiltered && highlightTaskIds!.size > 0 && !highlightTaskIds!.has(node.id);
    const data = toTaskData(node, dependencyCountByTaskId.get(node.id) ?? 0);

    return {
      id: node.id,
      type: "taskCard",
      position: { x: position.x, y: position.y },
      data,
      selected: selectedTaskId === node.id,
      draggable: false,
      selectable: true,
      connectable: false,
      style: {
        opacity: dimmed ? 0.22 : 1,
        transition: "opacity 120ms ease"
      }
    };
  });

  const edges: Edge[] = graph.edges.map((edge) =>
    toFlowEdge(edge, selectedTaskId, highlightTaskIds, isFiltered)
  );

  return { nodes: [...headerNodes, ...taskNodes], edges };
}

function toTaskData(node: GraphNodeView, dependencyCount: number): TaskNodeData {
  const data: TaskNodeData = {
    title: node.title,
    taskId: node.id,
    kind: node.kind,
    status: node.status,
    gateRequired: node.gateRequired === true,
    manual: node.manual === true,
    integrator: node.integrator === true,
    dependencyCount
  };

  if (node.authoredBy !== undefined) {
    data.authoredBy = node.authoredBy;
  }

  if (node.riskLevel !== undefined) {
    data.riskLevel = node.riskLevel;
  }

  if (node.expectedFiles !== undefined) {
    data.expectedFilesCount = node.expectedFiles.length;
    data.expectedFilesPreview = node.expectedFiles.slice(0, 4);
  }

  if (node.blockedReason !== undefined) {
    data.blockedReason = node.blockedReason;
  }

  if (node.traceCount !== undefined) {
    data.traceCount = node.traceCount;
  }

  return data;
}

interface PhaseHeaderData {
  label: string;
  count: number;
  [key: string]: unknown;
}

function phaseHeaderData(column: PhaseColumn): PhaseHeaderData {
  return {
    label: column.label,
    count: column.nodeCount
  };
}

function PhaseHeaderNode({ data }: NodeProps): React.ReactElement {
  const view = data as PhaseHeaderData;
  return (
    <div
      style={{
        width: 248,
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: "var(--text-3)",
        userSelect: "none"
      }}
    >
      <span
        className="phase-label"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--copper)",
          whiteSpace: "nowrap"
        }}
      >
        {view.label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-3)",
          whiteSpace: "nowrap"
        }}
      >
        {view.count} tasks
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
    </div>
  );
}

function toFlowEdge(
  edge: GraphEdgeView,
  selectedTaskId: string | null,
  highlightTaskIds: ReadonlySet<string> | null,
  isFiltered: boolean
): Edge {
  const isSelected = selectedTaskId !== null && (edge.source === selectedTaskId || edge.target === selectedTaskId);
  const dimmed = isFiltered && highlightTaskIds!.size > 0 &&
    !(highlightTaskIds!.has(edge.source) && highlightTaskIds!.has(edge.target));

  const baseStyle: { stroke: string; strokeWidth: number; strokeDasharray?: string } = (() => {
    if (edge.kind === "risk") {
      const color = edge.riskLevel ? RISK_EDGE_COLOR[edge.riskLevel] : "var(--risk-high)";
      return {
        stroke: color,
        strokeWidth: edge.acknowledged === true ? 1 : edge.riskLevel === "blocking" ? 1.8 : 1.4,
        strokeDasharray: edge.acknowledged === true ? "2 6" : "5 4"
      };
    }
    if (edge.kind === "gate") {
      return {
        stroke: "var(--gated)",
        strokeWidth: 1.4,
        strokeDasharray: "6 3"
      };
    }
    return {
      stroke: "var(--text-4)",
      strokeWidth: 1.1
    };
  })();

  if (isSelected) {
    baseStyle.strokeWidth += 0.6;
  }

  const result: Edge = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: edge.acknowledged !== true && edge.kind === "risk" && (edge.riskLevel === "blocking" || edge.riskLevel === "high"),
    style: {
      ...baseStyle,
      opacity: edge.acknowledged === true ? 0.24 : dimmed ? 0.14 : isSelected ? 1 : 0.7
    }
  };

  if (edge.label !== undefined && edge.kind !== "dependency") {
    result.label = edge.label;
    result.labelStyle = { fill: "var(--text-2)", fontSize: 10, fontFamily: "var(--font-mono)" };
    result.labelBgStyle = { fill: "var(--bg-1)", fillOpacity: 0.85 };
    result.labelBgPadding = [4, 2];
  }

  return result;
}

function miniMapNodeColor(data: TaskNodeData, type?: string): string {
  if (type === "phaseHeader") return "transparent";
  if (data.riskLevel === "blocking") return "var(--risk-blocking)";
  if (data.riskLevel === "high") return "var(--risk-high)";
  if (data.status === "done") return "var(--done)";
  if (data.status === "failed") return "var(--error)";
  if (data.status === "gated") return "var(--gated)";
  if (data.status === "blocked") return "var(--blocked)";
  if (data.status === "running") return "var(--running)";
  if (data.status === "ready") return "var(--ready)";
  return "var(--text-3)";
}
