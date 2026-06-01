"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
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
  RunGraphViewModel
} from "@/lib/graph-view-model";
import { riskColor } from "@/lib/status";
import {
  edgeIsRelated,
  nodeActionHint,
  type SelectionRelations
} from "@/lib/run-presentation";
import { TaskNodeCard, type TaskNodeData } from "./TaskNodeCard";

interface DagCanvasProps {
  graph: RunGraphViewModel;
  selectedTaskId: string | null;
  highlightTaskIds: ReadonlySet<string> | null;
  selectionRelations: SelectionRelations | null;
  onSelectTask: (taskId: string | null) => void;
}

const nodeTypes: NodeTypes = {
  taskCard: TaskNodeCard,
  phaseHeader: PhaseHeaderNode
};

const FIT_VIEW_OPTIONS = { padding: 0.18, includeHiddenNodes: false } as const;
/** Zoom level applied when focusing/centering a single node — close enough to read the card. */
const FOCUS_ZOOM = 1.1;

export function DagCanvas(props: DagCanvasProps): React.ReactElement {
  const { graph, selectedTaskId, highlightTaskIds, selectionRelations, onSelectTask } = props;
  const { fitView, setCenter, getNode } = useReactFlow();
  const [minimapVisible, setMinimapVisible] = useState(true);

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
    () => buildFlow(graph, selectedTaskId, highlightTaskIds, selectionRelations, dependencyCountByTaskId),
    [graph, selectedTaskId, highlightTaskIds, selectionRelations, dependencyCountByTaskId]
  );

  /** Center the viewport on a node by id (used by double-click + Focus control). */
  const centerOnNode = useCallback(
    (taskId: string) => {
      const node = getNode(taskId);
      if (node === undefined) return;
      const width = node.measured?.width ?? node.width ?? 248;
      const height = node.measured?.height ?? node.height ?? 150;
      void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: FOCUS_ZOOM,
        duration: 320
      });
    },
    [getNode, setCenter]
  );

  const handleFitView = useCallback(() => {
    void fitView(FIT_VIEW_OPTIONS);
  }, [fitView]);

  const handleFocusSelected = useCallback(() => {
    if (selectedTaskId !== null) centerOnNode(selectedTaskId);
  }, [centerOnNode, selectedTaskId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
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
      onNodeDoubleClick={(_event, node) => {
        if (node.type === "taskCard") {
          onSelectTask(node.id);
          centerOnNode(node.id);
        }
      }}
      onPaneClick={() => onSelectTask(null)}
      style={{ background: "transparent", width: "100%", height: "100%" }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(229,222,204,0.045)" />
      <CanvasControls
        minimapVisible={minimapVisible}
        hasSelection={selectedTaskId !== null}
        onFitView={handleFitView}
        onFocusSelected={handleFocusSelected}
        onToggleMinimap={() => setMinimapVisible((value) => !value)}
      />
      {minimapVisible ? (
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(26,25,21,0.65)"
          nodeColor={(node) => miniMapNodeColor(node.data as TaskNodeData, node.type)}
          nodeStrokeColor="var(--border)"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        />
      ) : null}
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

interface CanvasControlsProps {
  minimapVisible: boolean;
  hasSelection: boolean;
  onFitView: () => void;
  onFocusSelected: () => void;
  onToggleMinimap: () => void;
}

/**
 * Product-specific camera toolbar (P8). Sits in the top-right of the canvas and
 * complements React Flow's default zoom `<Controls>` with orchestration-tool
 * affordances: fit the whole graph, focus the selected node, and hide the
 * minimap for dense graphs. Pure viewport actions — never mutates the graph.
 */
function CanvasControls({
  minimapVisible,
  hasSelection,
  onFitView,
  onFocusSelected,
  onToggleMinimap
}: CanvasControlsProps): React.ReactElement {
  return (
    <Panel position="top-right" style={{ margin: 10 }}>
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: 6,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.28)"
        }}
      >
        <CanvasControlButton label="Fit" title="Fit the whole graph in view" onClick={onFitView} />
        <CanvasControlButton
          label="Focus"
          title={hasSelection ? "Center the selected node" : "Select a node to focus it"}
          onClick={onFocusSelected}
          disabled={!hasSelection}
        />
        <CanvasControlButton
          label={minimapVisible ? "Minimap on" : "Minimap off"}
          title="Toggle the minimap"
          onClick={onToggleMinimap}
          active={minimapVisible}
        />
      </div>
    </Panel>
  );
}

function CanvasControlButton({
  label,
  title,
  onClick,
  disabled = false,
  active = false
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 26,
        padding: "0 9px",
        border: `1px solid ${active ? "var(--copper)" : "var(--rule)"}`,
        background: active ? "rgba(180,113,72,0.12)" : "transparent",
        color: disabled ? "var(--text-4)" : active ? "var(--copper-hi)" : "var(--text-2)",
        borderRadius: 5,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        letterSpacing: 0.3,
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap"
      }}
    >
      {label}
    </button>
  );
}

function buildFlow(
  graph: RunGraphViewModel,
  selectedTaskId: string | null,
  highlightTaskIds: ReadonlySet<string> | null,
  selectionRelations: SelectionRelations | null,
  dependencyCountByTaskId: ReadonlyMap<string, number>
): { nodes: Node[]; edges: Edge[] } {
  const layout = layoutByDepth(graph.nodes);
  const isFiltered = highlightTaskIds !== null;
  const nodeStatusById = new Map(graph.nodes.map((node) => [node.id, node.status]));

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
    const data = toTaskData(
      node,
      dependencyCountByTaskId.get(node.id) ?? 0,
      relationForNode(node.id, selectionRelations)
    );

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
    toFlowEdge(edge, selectedTaskId, highlightTaskIds, selectionRelations, isFiltered, nodeStatusById)
  );

  return { nodes: [...headerNodes, ...taskNodes], edges };
}

function toTaskData(
  node: GraphNodeView,
  dependencyCount: number,
  relationship: TaskNodeData["relationship"]
): TaskNodeData {
  const data: TaskNodeData = {
    title: node.title,
    description: node.description,
    taskId: node.id,
    kind: node.kind,
    status: node.status,
    gateRequired: node.gateRequired === true,
    manual: node.manual === true,
    integrator: node.integrator === true,
    dependencyCount,
    actionHint: nodeActionHint(node)
  };

  if (relationship !== undefined) {
    data.relationship = relationship;
  }

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
  selectionRelations: SelectionRelations | null,
  isFiltered: boolean,
  nodeStatusById: ReadonlyMap<string, GraphNodeView["status"]>
): Edge {
  const isSelected = selectedTaskId !== null && (edge.source === selectedTaskId || edge.target === selectedTaskId);
  const isRelated = edgeIsRelated(edge, selectionRelations);
  const dimmed = isFiltered && highlightTaskIds!.size > 0 &&
    !(highlightTaskIds!.has(edge.source) && highlightTaskIds!.has(edge.target));
  const sourceStatus = nodeStatusById.get(edge.source);
  const targetStatus = nodeStatusById.get(edge.target);
  const completed = isCompletedStatus(sourceStatus) && isCompletedStatus(targetStatus);

  const baseStyle: { stroke: string; strokeWidth: number; strokeDasharray?: string } = (() => {
    if (edge.kind === "risk") {
      const color = edge.riskLevel ? riskColor(edge.riskLevel) : "var(--risk-high)";
      return {
        stroke: color,
        strokeWidth: edge.acknowledged === true ? 1 : edge.riskLevel === "blocking" ? 1.8 : 1.4,
        strokeDasharray: edge.acknowledged === true ? "2 6" : "5 4"
      };
    }
    if (edge.kind === "gate") {
      return {
        stroke: "var(--status-blocked-fg)",
        strokeWidth: 1.4,
        strokeDasharray: "6 3"
      };
    }
    if (completed) {
      return {
        stroke: "var(--status-integrated-fg)",
        strokeWidth: 1.25
      };
    }
    return {
      stroke: "var(--text-4)",
      strokeWidth: 1.1
    };
  })();

  if (isSelected) {
    baseStyle.strokeWidth += 0.6;
  } else if (isRelated) {
    baseStyle.strokeWidth += 0.35;
  }

  const result: Edge = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: edge.acknowledged !== true && edge.kind === "risk" && (edge.riskLevel === "blocking" || edge.riskLevel === "high"),
    style: {
      ...baseStyle,
      opacity: edge.acknowledged === true ? 0.24 : dimmed ? 0.14 : isSelected || isRelated ? 1 : 0.62
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

function relationForNode(taskId: string, relations: SelectionRelations | null): TaskNodeData["relationship"] {
  if (relations === null) return undefined;
  if (relations.selectedTaskId === taskId) return "selected";
  if (relations.ancestors.has(taskId)) return "ancestor";
  if (relations.dependencies.has(taskId)) return "dependency";
  if (relations.children.has(taskId)) return "child";
  return undefined;
}

function isCompletedStatus(status: GraphNodeView["status"] | undefined): boolean {
  return status === "done" || status === "approved" || status === "integrated";
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
