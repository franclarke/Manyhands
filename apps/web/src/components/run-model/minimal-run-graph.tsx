"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
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
import { ZoomIn, ZoomOut, Maximize, OctagonAlert, CircleSlash, Hand, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { nodeGlyph } from "@/lib/run-model/node-glyph";
import type { FocusTarget } from "@/lib/run-model/focus-view";
import type { MinimalRunGraph, ProductStage } from "@/lib/run-model/minimal-workspace-view";
import { layoutVerticalTaskDag } from "@/lib/run-model/run-graph-layout";
import type { RunCanvasMode } from "@/lib/run-model/run-canvas-projection";
import type { GraphEmptyKind } from "@/lib/run-model/run-phases";
import type { VitalStatus, WorkspaceNode } from "@/lib/run-model/workspace-view";

interface MinimalRunGraphProps {
  graph: MinimalRunGraph;
  stage: ProductStage;
  selectedTarget: FocusTarget | null;
  onFocus: (target: FocusTarget | null) => void;
  /** Fill the parent panel (cockpit) instead of the fixed-height page block. */
  fill?: boolean;
  /** What the empty canvas means when there are no nodes (planning vs failed). */
  emptyKind?: GraphEmptyKind;
  mode?: RunCanvasMode;
  overlayNodeIds?: readonly string[];
  dimOutsideOverlay?: boolean;
  waveLabel?: string | undefined;
  showHierarchyEdges?: boolean;
  showDependencyEdges?: boolean;
  showSeamEdges?: boolean;
  showConflictEdges?: boolean;
}

interface MinimalGraphNodeData {
  node: WorkspaceNode;
  stage: ProductStage;
  selected: boolean;
  /** Subtree accent (CSS var) — every branch reads as its own lane. */
  branch: string;
  /** On the selected node's path to the root (selected node included). */
  onPath: boolean;
  /** A node is focused elsewhere and this one is off that path → recede. */
  dimmed: boolean;
  /** Just streamed in (`plan.node.proposed`) — materialize with a settle pulse. */
  isNew: boolean;
  /** Just became integrated — briefly carry completion through its parent edge. */
  justIntegrated: boolean;
  /** Its own decomposition is still being generated (children pending). */
  expanding: boolean;
  collapsedChildCount: number;
  childSummary?: string;
  overlay: boolean;
  waveLabel?: string;
  [key: string]: unknown;
}

interface SkeletonGraphNodeData {
  dimmed: boolean;
  [key: string]: unknown;
}

/** Synthetic placeholder shown under a parent whose children are still streaming. */
const GHOST_PREFIX = "ghost:";
const BRANCH_VARS = [
  "var(--mh-branch-1)",
  "var(--mh-branch-2)",
  "var(--mh-branch-3)",
  "var(--mh-branch-4)",
  "var(--mh-branch-5)",
  "var(--mh-branch-6)"
];

function isGhostId(id: string): boolean {
  return id.startsWith(GHOST_PREFIX);
}

/** The decomposer is still generating this node's children. */
function isExpanding(node: WorkspaceNode): boolean {
  return node.vital.planningState === "generating" || node.vital.planningState === "retrying";
}

const nodeTypes: NodeTypes = {
  minimalTask: MinimalTaskNode,
  skeletonTask: SkeletonTaskNode
};

export function MinimalRunGraphCanvas(props: MinimalRunGraphProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <MinimalRunGraphInner {...props} />
    </ReactFlowProvider>
  );
}

interface CanvasControlsProps {
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

function CanvasControls({ onExpandAll, onCollapseAll }: CanvasControlsProps): React.ReactElement {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div className="absolute bottom-4 right-4 flex gap-1.5 p-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.02)] z-30 select-none">
      <button
        onClick={onExpandAll}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Expandir todo"
        aria-label="Expandir todo"
        type="button"
      >
        <ChevronsUpDown className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onCollapseAll}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Colapsar integrados"
        aria-label="Colapsar integrados"
        type="button"
      >
        <ChevronsDownUp className="w-3.5 h-3.5" />
      </button>
      <div className="w-[1px] h-3.5 bg-[var(--color-border)] self-center" aria-hidden />
      <button
        onClick={() => void fitView({ duration: 300, padding: 0.18 })}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Centrar DAG"
        aria-label="Centrar grafo de tareas"
        type="button"
      >
        <Maximize className="w-3.5 h-3.5" />
      </button>
      <div className="w-[1px] h-3.5 bg-[var(--color-border)] self-center" aria-hidden />
      <button
        onClick={() => void zoomIn({ duration: 200 })}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Acercar"
        aria-label="Acercar"
        type="button"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => void zoomOut({ duration: 200 })}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Alejar"
        aria-label="Alejar"
        type="button"
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function MinimalRunGraphInner({
  graph,
  stage,
  selectedTarget,
  onFocus,
  fill = false,
  emptyKind = "planning",
  mode = "tasks",
  overlayNodeIds = [],
  dimOutsideOverlay = false,
  waveLabel,
  showHierarchyEdges = true,
  showDependencyEdges = true,
  showSeamEdges = true,
  showConflictEdges = true
}: MinimalRunGraphProps): React.ReactElement {
  const selectedNodeId = selectedTarget?.kind === "node" ? selectedTarget.id : null;
  
  // Set of node IDs that the user manually expanded.
  const [userExpandedIds, setUserExpandedIds] = useState<Set<string>>(new Set());

  // Derived set of collapsed node IDs. By default, any composite/root node
  // that is "done" is collapsed, unless the user manually expanded it.
  const collapsedIds = useMemo(() => {
    const collapsed = new Set<string>();
    for (const node of graph.nodes) {
      if (node.role === "composite" || node.role === "root") {
        if (node.vital.status === "done" && !userExpandedIds.has(node.id)) {
          collapsed.add(node.id);
        }
      }
    }
    return collapsed;
  }, [graph.nodes, userExpandedIds]);

  const handleExpandAll = () => {
    const allComposites = graph.nodes
      .filter((n) => n.role === "composite" || n.role === "root")
      .map((n) => n.id);
    setUserExpandedIds(new Set(allComposites));
  };

  const handleCollapseAll = () => {
    setUserExpandedIds(new Set());
  };

  // Ids already on canvas — anything beyond this set just streamed in and
  // materializes with the settle entrance instead of popping.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const previousStatusesRef = useRef<Map<string, VitalStatus>>(new Map());
  const flow = useMemo(
    () => buildFlow(graph, stage, selectedNodeId, seenIdsRef.current, previousStatusesRef.current, collapsedIds, {
      mode,
      overlayNodeIds: new Set(overlayNodeIds),
      dimOutsideOverlay,
      waveLabel,
      showHierarchyEdges,
      showDependencyEdges,
      showSeamEdges,
      showConflictEdges
    }),
    [collapsedIds, dimOutsideOverlay, graph, mode, overlayNodeIds, selectedNodeId, showConflictEdges, showDependencyEdges, showHierarchyEdges, showSeamEdges, stage, waveLabel]
  );
  useEffect(() => {
    for (const node of flow.nodes) {
      if (!isGhostId(node.id)) seenIdsRef.current.add(node.id);
    }
    previousStatusesRef.current = new Map(graph.nodes.map((node) => [node.id, node.vital.status]));
  }, [flow, graph.nodes]);

  // Frame the first proposed node once. Afterwards the viewport remains under
  // the operator's control while planning and execution events stream in.
  const initialFrameDoneRef = useRef(false);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (initialFrameDoneRef.current || flow.nodes.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      initialFrameDoneRef.current = true;
      void fitView({
        nodes: flow.nodes.map((node) => ({ id: node.id })),
        padding: 0.22,
        maxZoom: 0.82,
        duration: 0
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [fitView, flow.nodes]);

  return (
    <section className={fill ? "mh-run-graph mh-run-graph-fill" : "mh-run-graph"} aria-label="Grafo de tareas del run">
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 0, y: 0, zoom: 0.72 }}
        minZoom={0.35}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        selectionOnDrag={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => {
          if (isGhostId(node.id)) return;
          if (collapsedIds.has(node.id)) {
            setUserExpandedIds((prev) => {
              const next = new Set(prev);
              next.add(node.id);
              return next;
            });
          }
          onFocus({ kind: "node", id: node.id });
        }}
        onPaneClick={() => onFocus(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="var(--mh-graph-dots)" />
        <CanvasControls onExpandAll={handleExpandAll} onCollapseAll={handleCollapseAll} />
        {flow.nodes.filter((node) => node.type === "minimalTask").length > 12 ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            nodeColor={(node) => {
              const data = node.data as Partial<MinimalGraphNodeData>;
              const status = data.node?.vital.status;
              // Idle/pending nodes need a visible neutral in the tiny map.
              if (status === undefined || status === "idle") return "var(--rule-strong)";
              return STATUS_DOT[status];
            }}
            maskColor="color-mix(in srgb, var(--color-bg) 72%, transparent)"
          />
        ) : null}
        {graph.nodes.length === 0 ? <GraphEmptyState kind={emptyKind} /> : null}
      </ReactFlow>
    </section>
  );
}

function GraphEmptyState({ kind }: { kind: GraphEmptyKind }): React.ReactElement {
  if (kind === "failed") {
    return (
      <div className="mh-run-graph-planning-state" aria-live="polite">
        <div className="mh-planning-root-node mh-graph-empty-failed">
          <span className="mh-graph-empty-eyebrow" style={{ color: "var(--status-failed-fg)" }}>
            <OctagonAlert aria-hidden className="h-3.5 w-3.5" />
            Run fallido
          </span>
          <strong>El run falló antes de generar el plan</strong>
          <p>No se llegó a proponer ninguna tarea. Revisá la actividad en la pestaña Eventos o reintentá el run.</p>
        </div>
      </div>
    );
  }
  if (kind === "interrupted") {
    return (
      <div className="mh-run-graph-planning-state" aria-live="polite">
        <div className="mh-planning-root-node mh-graph-empty-interrupted">
          <span className="mh-graph-empty-eyebrow" style={{ color: "var(--color-text-subtle)" }}>
            <CircleSlash aria-hidden className="h-3.5 w-3.5" />
            Run interrumpido
          </span>
          <strong>El run se detuvo antes de generar el plan</strong>
          <p>La planificación se interrumpió. Podés reanudar o reintentar el run cuando quieras.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mh-run-graph-planning-state" aria-live="polite">
      <div className="mh-planning-root-node mh-working">
        <span className="mh-live mh-live-on">Planificando</span>
        <strong>Construyendo el grafo</strong>
        <p>ManyHands está resolviendo el contexto del repo. El primer nodo del plan aparece acá apenas se propone.</p>
      </div>
    </div>
  );
}

function buildFlow(
  graph: MinimalRunGraph,
  stage: ProductStage,
  selectedNodeId: string | null,
  seenIds: ReadonlySet<string>,
  previousStatuses: ReadonlyMap<string, VitalStatus>,
  collapsedIds: ReadonlySet<string>,
  lens: {
    mode: RunCanvasMode;
    overlayNodeIds: ReadonlySet<string>;
    dimOutsideOverlay: boolean;
    waveLabel?: string | undefined;
    showHierarchyEdges: boolean;
    showDependencyEdges: boolean;
    showSeamEdges: boolean;
    showConflictEdges: boolean;
  }
): { nodes: Node<MinimalGraphNodeData | SkeletonGraphNodeData>[]; edges: Edge[] } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const justIntegratedIds = new Set(
    graph.nodes
      .filter((node) => node.vital.status === "done" && previousStatuses.get(node.id) !== undefined && previousStatuses.get(node.id) !== "done")
      .map((node) => node.id)
  );

  // Ghost children: while a parent's decomposition streams in, a skeleton node
  // reserves its place so the arriving children glide in instead of popping.
  const ghosts: WorkspaceNode[] = graph.nodes.filter(isExpanding).map((parent) => ({
    ...parent,
    id: `${GHOST_PREFIX}${parent.id}`,
    parentId: parent.id,
    role: "leaf",
    depth: parent.depth + 1,
    title: "",
    produces: [],
    consumes: []
  }));
  const allNodes = [...graph.nodes, ...ghosts];
  for (const ghost of ghosts) byId.set(ghost.id, ghost);

  // Hidden nodes list calculation: any node having any ancestor in collapsedIds is hidden.
  const hiddenIds = new Set<string>();
  const isHidden = (nodeId: string): boolean => {
    let cur = byId.get(nodeId);
    while (cur && cur.parentId !== null) {
      if (collapsedIds.has(cur.parentId)) {
        return true;
      }
      cur = byId.get(cur.parentId);
    }
    return false;
  };
  for (const node of allNodes) {
    if (isHidden(node.id)) {
      hiddenIds.add(node.id);
    }
  }

  // Branch identity: the top-level ancestor (a direct child of the root) owns a
  // colour; the root is neutral; descendants inherit their branch's colour.
  // Ghosts are EXCLUDED from key assignment so lane colours never shift when a
  // placeholder appears or resolves.
  const branchOf = (node: WorkspaceNode): string | null => {
    let cur: WorkspaceNode = node;
    while (cur.parentId !== null) {
      const parent = byId.get(cur.parentId);
      if (parent === undefined || parent.parentId === null) break; // parent is the root
      cur = parent;
    }
    return cur.parentId === null ? null : cur.id; // null → the root itself
  };
  const branchKeys = [...new Set(graph.nodes.map((n) => branchOf(n)).filter((k): k is string => k !== null))].sort();
  const branchColorFor = (node: WorkspaceNode): string => {
    const key = branchOf(node);
    if (key === null) return "var(--mh-branch-root)";
    if (isGhostId(key)) return "var(--color-accent)";
    const index = branchKeys.indexOf(key);
    if (index === -1) return "var(--color-accent)";
    return BRANCH_VARS[index % BRANCH_VARS.length]!;
  };

  // Helper to find closest ancestor that is visible (the collapsed node itself).
  const getClosestVisibleAncestor = (nodeId: string): string => {
    let cur = byId.get(nodeId);
    while (cur && cur.parentId !== null) {
      if (collapsedIds.has(cur.parentId)) {
        return cur.parentId;
      }
      cur = byId.get(cur.parentId);
    }
    return nodeId;
  };

  const pos = layoutVerticalTaskDag(allNodes, collapsedIds);

  // Path to root for the selected node (the node itself + every ancestor).
  const pathSet = new Set<string>();
  if (selectedNodeId !== null) {
    let cur: WorkspaceNode | undefined = byId.get(selectedNodeId);
    while (cur !== undefined) {
      pathSet.add(cur.id);
      cur = cur.parentId !== null ? byId.get(cur.parentId) : undefined;
    }
  }
  const hasSelection = selectedNodeId !== null;

  const flowNodes: Node<MinimalGraphNodeData | SkeletonGraphNodeData>[] = allNodes
    .filter((node) => !hiddenIds.has(node.id))
    .map((node) => {
      const position = pos.get(node.id) ?? { x: 0, y: node.depth * 160 };
      if (isGhostId(node.id)) {
        return {
          id: node.id,
          type: "skeletonTask",
          position,
          selectable: false,
          focusable: false,
          data: { dimmed: hasSelection }
        };
      }
      const isCollapsed = collapsedIds.has(node.id);
      const directChildren = graph.nodes.filter((n) => n.parentId === node.id);
      const collapsedChildCount = isCollapsed ? directChildren.length : 0;
      const integratedChildren = directChildren.filter((child) => child.display === "done").length;
      const childSummary = node.role === "root"
        ? `${graph.nodes.length} tareas · ${graph.nodes.filter((child) => child.display === "done").length} integradas`
        : node.role === "composite"
          ? `${integratedChildren}/${directChildren.length} hijas integradas`
          : undefined;
      const overlay = lens.overlayNodeIds.has(node.id);
      const lensDimmed = lens.dimOutsideOverlay && !overlay;
      return {
        id: node.id,
        type: "minimalTask",
        position,
        ariaLabel: `${node.title} · ${roleLabel(node.role, node.depth)} · ${node.vital.label}`,
        ariaRole: "group",
        data: {
          node,
          stage,
          selected: selectedNodeId === node.id,
          branch: branchColorFor(node),
          onPath: pathSet.has(node.id),
          dimmed: (hasSelection && !pathSet.has(node.id)) || lensDimmed,
          isNew: !seenIds.has(node.id),
          justIntegrated: justIntegratedIds.has(node.id),
          expanding: isExpanding(node),
          collapsedChildCount,
          childSummary,
          overlay,
          waveLabel: overlay ? lens.waveLabel : undefined
        }
      };
    });

  const flowEdges: Edge[] = [];
  for (const edge of graph.edges) {
    const isHierarchy = edge.kind === "hierarchy";
    const isDependency = edge.kind === "dependency";
    const isSeam = edge.kind === "seam";
    const isConflict = edge.kind === "conflict";
    if (isHierarchy && !lens.showHierarchyEdges) continue;
    if (isDependency && !lens.showDependencyEdges) continue;
    if (isSeam && !lens.showSeamEdges) continue;
    if (isConflict && !lens.showConflictEdges) continue;
    let sourceId = edge.source;
    let targetId = edge.target;

    if (!isHierarchy) {
      if (hiddenIds.has(sourceId)) {
        sourceId = getClosestVisibleAncestor(sourceId);
      }
      if (hiddenIds.has(targetId)) {
        targetId = getClosestVisibleAncestor(targetId);
      }
      if (sourceId === targetId) {
        continue;
      }
    } else {
      if (hiddenIds.has(sourceId) || hiddenIds.has(targetId)) {
        continue;
      }
    }

    const target = byId.get(targetId);

    const onPath = isHierarchy && pathSet.has(sourceId) && pathSet.has(targetId);
    const overlayEdge = lens.overlayNodeIds.has(sourceId) && lens.overlayNodeIds.has(targetId);
    const dimmed = (hasSelection && !onPath) || (lens.dimOutsideOverlay && !overlayEdge);
    
    // Hierarchy edges into a still-expanding subtree march with the stream.
    const streaming = isHierarchy && target !== undefined && isExpanding(target);
    
    // Integration has no imperative UI state: the durable transition to done is
    // enough to carry a short bottom-up confirmation through its hierarchy edge.
    const integrating = isHierarchy && (justIntegratedIds.has(sourceId) || justIntegratedIds.has(targetId));
    const connecting = !seenIds.has(sourceId) || !seenIds.has(targetId);

    const branchColor = target !== undefined ? branchColorFor(target) : "var(--mh-graph-edge)";
    const stroke = isDependency
      ? "var(--mh-graph-dependency)"
      : isSeam
        ? "var(--mh-graph-seam)"
        : isConflict
          ? "var(--mh-graph-conflict)"
          : branchColor;
    const interfaceEmphasis = lens.mode === "interfaces" && isSeam;
    const integrationEmphasis = lens.mode === "integration" && (isHierarchy || isConflict);
    const crossNodeEdge = !isHierarchy;

    flowEdges.push({
      id: crossNodeEdge ? `${edge.id}:remapped:${sourceId}->${targetId}` : edge.id,
      source: sourceId,
      target: targetId,
      type: "smoothstep",
      animated: onPath || integrationEmphasis || integrating || connecting,
      ...(integrating ? { className: "edge-flow-reverse" } : streaming || connecting ? { className: "edge-flow" } : {}),
      ...(!isConflict ? { markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: stroke } } : {}),
      style: {
        stroke,
        strokeWidth: onPath ? 2.4 : interfaceEmphasis || integrationEmphasis ? 2.2 : integrating ? 2.2 : crossNodeEdge ? 1.6 : 1.4,
        strokeDasharray: isDependency ? "8 4" : isSeam ? "4 5" : isConflict ? "2 4" : streaming || integrating ? "4 6" : undefined,
        opacity: dimmed ? 0.12 : interfaceEmphasis ? 0.95 : integrationEmphasis ? 0.9 : integrating ? 0.85 : crossNodeEdge ? 0.72 : 0.55,
        transition: "opacity 200ms ease, stroke-width 200ms ease"
      }
    });
  }

  // Parent → ghost: the stream itself, drawn as a marching dashed ember edge.
  for (const ghost of ghosts) {
    if (hiddenIds.has(ghost.id) || hiddenIds.has(ghost.parentId!)) continue;
    flowEdges.push({
      id: `ghost-edge:${ghost.parentId}`,
      source: ghost.parentId!,
      target: ghost.id,
      type: "smoothstep",
      className: "edge-flow",
      style: {
        stroke: "var(--mh-graph-seam)",
        strokeWidth: 1.6,
        opacity: hasSelection ? 0.3 : 0.9
      }
    });
  }

  return { nodes: flowNodes, edges: flowEdges };
}

const STATUS_DOT: Record<VitalStatus, string> = {
  idle: "var(--text-4)",
  planning: "var(--copper)",
  running: "var(--running)",
  verifying: "var(--running)",
  repairing: "var(--running)",
  gated: "var(--gated)",
  done: "var(--done)",
  obsolete: "var(--warning)",
  blocked: "var(--warning)",
  failed: "var(--error)"
};

function SkeletonTaskNode({ data }: NodeProps<Node<SkeletonGraphNodeData>>): React.ReactElement {
  return (
    <div
      className="mh-skel-node"
      style={{ opacity: data.dimmed ? 0.3 : 1 }}
      aria-label="Generando la próxima subtarea"
      aria-busy
    >
      <Handle type="target" position={Position.Top} className="mh-min-node-handle" />
      <Handle type="source" position={Position.Bottom} className="mh-min-node-handle" />
      <div className="mh-min-node-top">
        <span
          className="mh-min-node-dot coral-pulse"
          style={{ background: "var(--color-accent)", opacity: 1 }}
          aria-hidden
        />
        <span className="mh-min-node-role" style={{ color: "var(--color-accent)" }}>
          generando…
        </span>
      </div>
      <div className="mh-skel-node-bar" style={{ width: "78%", marginTop: 12 }} aria-hidden />
      <div className="mh-skel-node-bar" style={{ width: "52%" }} aria-hidden />
    </div>
  );
}

function MinimalTaskNode({ data }: NodeProps<Node<MinimalGraphNodeData>>): React.ReactElement {
  const { node, selected, branch, onPath, dimmed, isNew, justIntegrated, expanding, collapsedChildCount, childSummary, overlay, waveLabel } = data;
  const status = node.vital.status;
  const hasProgress = node.vital.testProgress !== undefined;
  const glyph = nodeGlyph(status);
  const active = status === "planning" || status === "running" || status === "verifying" || status === "repairing";
  const isRoot = node.role === "root";
  const attention = status === "failed" || status === "blocked" || status === "obsolete";

  return (
    <article
      aria-label={`${node.title} · ${roleLabel(node.role, node.depth)} · ${node.vital.label}`}
      aria-roledescription="tarea del plan"
      className={[
        "mh-min-node",
        isRoot ? "mh-min-node-root" : "",
        node.isInWavefront ? "mh-min-node-wave" : "",
        overlay ? "mh-min-node-overlay" : "",
        selected ? "mh-min-node-selected" : "",
        onPath && !selected ? "mh-min-node-onpath" : "",
        isNew ? "mh-min-node-enter" : "",
        justIntegrated ? "mh-min-node-integrated" : "",
        expanding ? "mh-min-node-expanding" : "",
        status === "failed" ? "mh-min-node-failed" : "",
        status === "blocked" ? "mh-min-node-blocked" : "",
        status === "obsolete" ? "mh-min-node-obsolete" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        // The left rail encodes the BRANCH; status lives in the dot + label below.
        ["--branch" as string]: branch,
        borderLeftColor: selected ? "var(--accent)" : isRoot ? "var(--rule-control)" : branch,
        opacity: dimmed ? 0.34 : undefined,
        filter: dimmed ? "saturate(0.55)" : "none"
      }}
    >
      <Handle type="target" position={Position.Top} className="mh-min-node-handle" />
      <Handle type="source" position={Position.Bottom} className="mh-min-node-handle" />
      <div className="mh-min-node-top">
        {glyph.kind === "hand" ? (
          // Gated waits on a person — an affordance, not a coloured dot (gated and
          // blocked share the same ochre token, so shape is the separator).
          <span className="mh-min-node-glyph" aria-hidden>
            <Hand size={14} />
          </span>
        ) : (
          <span
            className={`mh-min-node-dot mh-min-node-dot--${glyph.variant}${active ? " coral-pulse" : ""}`}
            aria-hidden
          />
        )}
        <span className="mh-min-node-role">{roleLabel(node.role, node.depth)}</span>
        {waveLabel !== undefined ? <span className="mh-min-node-wave-label">{waveLabel}</span> : null}
      </div>
      <h3>{node.title}</h3>
      <p style={attention ? { color: STATUS_DOT[status], fontWeight: 500 } : undefined}>{node.vital.label}</p>
      {childSummary !== undefined ? <small className="mh-mono">{childSummary}</small> : null}
      {hasProgress ? (
        <div
          className="mh-min-node-progress"
          aria-label={`Tests ${node.vital.testProgress?.pass}/${node.vital.testProgress?.total}`}
        >
          <span style={{ width: progressWidth(node) }} />
        </div>
      ) : null}
      {node.vital.detail !== undefined && status !== "idle" ? <small>{compactDetail(node.vital.detail)}</small> : null}
      {collapsedChildCount > 0 && (
        <div className="flex justify-start">
          <span className="mh-min-node-collapsed-badge">
            +{collapsedChildCount}
          </span>
        </div>
      )}
    </article>
  );
}

function roleLabel(role: WorkspaceNode["role"], depth: number): string {
  if (role === "root") return "raíz";
  if (role === "composite") return `grupo · d${depth}`;
  return `tarea · d${depth}`;
}

function progressWidth(node: WorkspaceNode): string {
  const progress = node.vital.testProgress;
  if (progress === undefined || progress.total === 0) return "18%";
  return `${Math.max(12, Math.round((progress.pass / progress.total) * 100))}%`;
}

function compactDetail(detail: string): string {
  if (detail.length <= 48) return detail;
  return `${detail.slice(0, 45)}...`;
}
