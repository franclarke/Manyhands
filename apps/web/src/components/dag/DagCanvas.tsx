"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Edge,
  MarkerType,
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
  onToggleFullscreen?: () => void;
}

const nodeTypes: NodeTypes = {
  taskCard: TaskNodeCard,
  phaseHeader: PhaseHeaderNode
};

const FIT_VIEW_OPTIONS = { padding: 0.12, includeHiddenNodes: false } as const;
/** Zoom level applied when focusing/centering a single node — close enough to read the card. */
const FOCUS_ZOOM = 1.1;
const EDGE_MUTED = "rgba(241,234,216,0.18)";
const TREE_EDGE = "rgba(185,173,152,0.50)";
const EDGE_CONTEXT = "rgba(215,155,114,0.88)";
const EDGE_RELATED = "rgba(185,173,152,0.70)";

export function DagCanvas(props: DagCanvasProps): React.ReactElement {
  const { graph, selectedTaskId, highlightTaskIds, selectionRelations, onSelectTask, onToggleFullscreen } = props;
  const { fitView, setCenter, getNode } = useReactFlow();
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Listen for native fullscreenchange to re-fit the view and update button icon
  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement !== null;
      setIsFullscreen(active);
      // Give the browser a frame to settle the new dimensions
      requestAnimationFrame(() => {
        void fitView(FIT_VIEW_OPTIONS);
      });
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [fitView]);

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

  useEffect(() => {
    void fitView(FIT_VIEW_OPTIONS);
  }, [fitView, nodes.length]);

  /** Center the viewport on a node by id (used by double-click + Focus control). */
  const centerOnNode = useCallback(
    (taskId: string) => {
      const node = getNode(taskId);
      if (node === undefined) return;
      const width = node.measured?.width ?? node.width ?? 292;
      const height = node.measured?.height ?? node.height ?? 160;
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
      minZoom={0.45}
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
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(241,234,216,0.035)" />
      <CanvasControls
        minimapVisible={minimapVisible}
        hasSelection={selectedTaskId !== null}
        isFullscreen={isFullscreen}
        onFitView={handleFitView}
        onFocusSelected={handleFocusSelected}
        onToggleMinimap={() => setMinimapVisible((value) => !value)}
        {...(onToggleFullscreen !== undefined ? { onToggleFullscreen } : {})}
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
  isFullscreen: boolean;
  onFitView: () => void;
  onFocusSelected: () => void;
  onToggleMinimap: () => void;
  onToggleFullscreen?: () => void;
}

/**
 * Product-specific camera toolbar (P8). Sits in the top-right of the canvas and
 * complements React Flow's default zoom `<Controls>` with orchestration-tool
 * affordances: fit the whole graph, focus the selected node, hide the
 * minimap for dense graphs, and toggle fullscreen. Pure viewport actions — never mutates the graph.
 */
function CanvasControls({
  minimapVisible,
  hasSelection,
  isFullscreen,
  onFitView,
  onFocusSelected,
  onToggleMinimap,
  onToggleFullscreen
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
        {onToggleFullscreen !== undefined ? (
          <button
            type="button"
            onClick={onToggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 36,
              width: 36,
              padding: 0,
              border: "1px solid var(--rule-control)",
              background: "rgba(241,234,216,0.035)",
              color: "var(--text-2)",
              borderRadius: 5,
              cursor: "pointer"
            }}
          >
            {isFullscreen ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 1H1v4M9 1h4v4M5 13H1V9M9 13h4V9" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" />
              </svg>
            )}
          </button>
        ) : null}
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
        minHeight: 36,
        padding: "0 11px",
        border: `1px solid ${active ? "var(--copper)" : "var(--rule-control)"}`,
        background: active ? "rgba(208,138,90,0.14)" : "rgba(241,234,216,0.035)",
        color: disabled ? "var(--text-4)" : active ? "var(--copper-hi)" : "var(--text-2)",
        borderRadius: 5,
        fontSize: 12,
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

  const hierarchyEdges = buildHierarchyEdges(graph.nodes, selectedTaskId, highlightTaskIds, selectionRelations, isFiltered);
  const edges: Edge[] = graph.edges.map((edge) =>
    toFlowEdge(edge, selectedTaskId, highlightTaskIds, selectionRelations, isFiltered)
  );

  return { nodes: [...headerNodes, ...taskNodes], edges: [...hierarchyEdges, ...edges] };
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

function buildHierarchyEdges(
  nodes: readonly GraphNodeView[],
  selectedTaskId: string | null,
  highlightTaskIds: ReadonlySet<string> | null,
  selectionRelations: SelectionRelations | null,
  isFiltered: boolean
): Edge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return nodes
    .filter((node) => node.parentId !== null && node.parentId !== undefined && nodeIds.has(node.parentId))
    .map((node) => {
      const parentId = node.parentId as string;
      const isSelected = selectedTaskId !== null && (selectedTaskId === parentId || selectedTaskId === node.id);
      const isRelated =
        selectionRelations !== null &&
        selectionRelations.related.has(parentId) &&
        selectionRelations.related.has(node.id);
      const contextual = isSelected || isRelated;
      const dimmed =
        isFiltered &&
        highlightTaskIds !== null &&
        highlightTaskIds.size > 0 &&
        !(highlightTaskIds.has(parentId) && highlightTaskIds.has(node.id));

      return {
        id: `hierarchy:${parentId}:${node.id}`,
        source: parentId,
        target: node.id,
        type: "smoothstep",
        selectable: false,
        focusable: false,
        ...(contextual
          ? {
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: isSelected ? EDGE_CONTEXT : EDGE_RELATED,
                width: 12,
                height: 12
              }
            }
          : {}),
        style: {
          stroke: contextual ? (isSelected ? EDGE_CONTEXT : EDGE_RELATED) : TREE_EDGE,
          strokeWidth: isSelected ? 1.6 : 1.08,
          strokeLinecap: "round",
          opacity: dimmed ? 0.12 : contextual ? 0.78 : 0.66
        },
        zIndex: contextual ? 2 : 0
      } satisfies Edge;
    });
}

function PhaseHeaderNode({ data }: NodeProps): React.ReactElement {
  const view = data as PhaseHeaderData;
  return (
    <div
      style={{
        width: 292,
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: "var(--text-2)",
        userSelect: "none"
      }}
    >
      <span
        className="phase-label"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.14em",
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
          fontSize: 11,
          color: "var(--text-2)",
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
  isFiltered: boolean
): Edge {
  const isSelected = selectedTaskId !== null && (edge.source === selectedTaskId || edge.target === selectedTaskId);
  const isRelated = edgeIsRelated(edge, selectionRelations);
  const dimmed = isFiltered && highlightTaskIds!.size > 0 &&
    !(highlightTaskIds!.has(edge.source) && highlightTaskIds!.has(edge.target));
  const contextual = isSelected || isRelated;

  const baseStyle: { stroke: string; strokeWidth: number; strokeDasharray?: string } = (() => {
    if (edge.kind === "risk") {
      const color = edge.riskLevel ? riskColor(edge.riskLevel) : "var(--risk-high)";
      return {
        stroke: contextual ? color : EDGE_MUTED,
        strokeWidth: contextual ? (edge.riskLevel === "blocking" ? 1.8 : 1.45) : 0.9,
        strokeDasharray: edge.acknowledged === true ? "2 7" : "4 6"
      };
    }
    if (edge.kind === "gate") {
      return {
        stroke: contextual ? "var(--status-blocked-fg)" : EDGE_MUTED,
        strokeWidth: contextual ? 1.45 : 0.9,
        strokeDasharray: "4 6"
      };
    }
    return {
      stroke: contextual ? (isSelected ? EDGE_CONTEXT : EDGE_RELATED) : EDGE_MUTED,
      strokeWidth: contextual ? (isSelected ? 1.55 : 1.2) : 0.9
    };
  })();

  const result: Edge = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    hidden: !contextual && !isFiltered,
    animated: false,
    ...(contextual
      ? {
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: baseStyle.stroke,
            width: 14,
            height: 14
          }
        }
      : {}),
    style: {
      ...baseStyle,
      opacity: edge.acknowledged === true ? 0.2 : dimmed ? 0.08 : contextual ? 0.92 : 0.18
    },
    zIndex: contextual ? 3 : 0
  };

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
