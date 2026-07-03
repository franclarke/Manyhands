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
import type { GraphEmptyKind } from "@/lib/run-model/run-phases";
import type { VitalStatus, WorkspaceNode } from "@/lib/run-model/workspace-view";

interface MinimalRunGraphProps {
  graph: MinimalRunGraph;
  stage: ProductStage;
  selectedTarget: FocusTarget | null;
  onFocus: (target: FocusTarget) => void;
  /** Fill the parent panel (cockpit) instead of the fixed-height page block. */
  fill?: boolean;
  /** What the empty canvas means when there are no nodes (planning vs failed). */
  emptyKind?: GraphEmptyKind;
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
  /** Its own decomposition is still being generated (children pending). */
  expanding: boolean;
  collapsedChildCount: number;
  [key: string]: unknown;
}

interface SkeletonGraphNodeData {
  dimmed: boolean;
  [key: string]: unknown;
}

const X_GAP = 296;
const Y_GAP = 132;
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
        type="button"
      >
        <ChevronsUpDown className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onCollapseAll}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Colapsar integrados"
        type="button"
      >
        <ChevronsDownUp className="w-3.5 h-3.5" />
      </button>
      <div className="w-[1px] h-3.5 bg-[var(--color-border)] self-center" aria-hidden />
      <button
        onClick={() => void fitView({ duration: 300, padding: 0.18 })}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Centrar DAG"
        type="button"
      >
        <Maximize className="w-3.5 h-3.5" />
      </button>
      <div className="w-[1px] h-3.5 bg-[var(--color-border)] self-center" aria-hidden />
      <button
        onClick={() => void zoomIn({ duration: 200 })}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Acercar"
        type="button"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => void zoomOut({ duration: 200 })}
        className="p-1.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-lg transition-colors cursor-pointer"
        title="Alejar"
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
  emptyKind = "planning"
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
  const flow = useMemo(
    () => buildFlow(graph, stage, selectedNodeId, seenIdsRef.current, collapsedIds),
    [graph, stage, selectedNodeId, collapsedIds]
  );
  useEffect(() => {
    for (const node of flow.nodes) {
      if (!isGhostId(node.id)) seenIdsRef.current.add(node.id);
    }
  }, [flow]);

  // Keep the graph framed when the canvas resizes — the delivery panel mounting
  // (review stage) or a window resize shrinks the container, and `fitView` only
  // runs on init, so without this the bottom nodes clip and the tree drifts.
  const sectionRef = useRef<HTMLElement>(null);
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = sectionRef.current;
    if (el === null) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => void fitView({ padding: 0.18, duration: 200 }));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [fitView]);

  return (
    <section ref={sectionRef} className={fill ? "mh-run-graph mh-run-graph-fill" : "mh-run-graph"} aria-label="Grafo de tareas del run">
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, includeHiddenNodes: false }}
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
        onPaneClick={() => undefined}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="var(--mh-graph-dots)" />
        <CanvasControls onExpandAll={handleExpandAll} onCollapseAll={handleCollapseAll} />
        {graph.nodes.length > 12 ? (
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
        <FitViewOnGrowth count={flow.nodes.length} />
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

/** Keep the whole tree framed as nodes stream in during planning. */
function FitViewOnGrowth({ count }: { count: number }): null {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 320 });
    }, 60);
    return () => window.clearTimeout(handle);
  }, [count, fitView]);
  return null;
}

function buildFlow(
  graph: MinimalRunGraph,
  stage: ProductStage,
  selectedNodeId: string | null,
  seenIds: ReadonlySet<string>,
  collapsedIds: ReadonlySet<string>
): { nodes: Node<MinimalGraphNodeData | SkeletonGraphNodeData>[]; edges: Edge[] } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

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

  const childrenOf = new Map<string, WorkspaceNode[]>();
  for (const node of allNodes) {
    if (node.parentId !== null && byId.has(node.parentId)) {
      const bucket = childrenOf.get(node.parentId) ?? [];
      bucket.push(node);
      childrenOf.set(node.parentId, bucket);
    }
  }
  for (const bucket of childrenOf.values()) {
    // Ghosts sit after their real siblings: the "next child" materializes below.
    bucket.sort((a, b) => {
      const ghostOrder = Number(isGhostId(a.id)) - Number(isGhostId(b.id));
      return ghostOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
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

  // Tidy layout: a DFS that packs each subtree into a contiguous vertical band and
  // centres every parent over its children, so siblings sit together and branches
  // never interleave.
  // If a node is collapsed, we treat it as a leaf (kids.length === 0) for layout calculation,
  // making the graph contract cleanly.
  const pos = new Map<string, { x: number; y: number }>();
  let leafCursor = 0;
  const place = (node: WorkspaceNode): number => {
    const isCollapsed = collapsedIds.has(node.id);
    const kids = isCollapsed ? [] : (childrenOf.get(node.id) ?? []);
    let y: number;
    if (kids.length === 0) {
      y = leafCursor * Y_GAP;
      leafCursor += 1;
    } else {
      const ys = kids.map((kid) => place(kid));
      y = (ys[0]! + ys[ys.length - 1]!) / 2;
    }
    pos.set(node.id, { x: node.depth * X_GAP, y });
    return y;
  };
  const roots = allNodes
    .filter((node) => node.parentId === null || !byId.has(node.parentId))
    .sort((a, b) => a.title.localeCompare(b.title));
  for (const root of roots) place(root);

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
      const position = pos.get(node.id) ?? { x: node.depth * X_GAP, y: 0 };
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
      return {
        id: node.id,
        type: "minimalTask",
        position,
        data: {
          node,
          stage,
          selected: selectedNodeId === node.id,
          branch: branchColorFor(node),
          onPath: pathSet.has(node.id),
          dimmed: hasSelection && !pathSet.has(node.id),
          isNew: !seenIds.has(node.id),
          expanding: isExpanding(node),
          collapsedChildCount
        }
      };
    });

  const flowEdges: Edge[] = [];
  for (const edge of graph.edges) {
    const isDependency = edge.kind === "dependency";
    let sourceId = edge.source;
    let targetId = edge.target;

    if (isDependency) {
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
    const source = byId.get(sourceId);

    const onPath = !isDependency && pathSet.has(sourceId) && pathSet.has(targetId);
    const dimmed = hasSelection && !onPath;
    
    // Hierarchy edges into a still-expanding subtree march with the stream.
    const streaming = !isDependency && target !== undefined && isExpanding(target);
    
    // Hierarchy edges FROM an integrating composite flow in reverse (bottom-up).
    const integrating =
      !isDependency &&
      source !== undefined &&
      source.role !== "leaf" &&
      source.vital.status === "running";

    const branchColor = target !== undefined ? branchColorFor(target) : "var(--mh-graph-edge)";
    const stroke = isDependency ? "var(--mh-graph-seam)" : branchColor;

    flowEdges.push({
      id: isDependency ? `${edge.id}:remapped:${sourceId}->${targetId}` : edge.id,
      source: sourceId,
      target: targetId,
      type: "smoothstep",
      animated: onPath,
      ...(integrating ? { className: "edge-flow-reverse" } : streaming ? { className: "edge-flow" } : {}),
      markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: stroke },
      style: {
        stroke,
        strokeWidth: onPath ? 2.4 : integrating ? 2.2 : isDependency ? 1.5 : 1.4,
        strokeDasharray: isDependency ? "4 5" : streaming || integrating ? "4 6" : undefined,
        opacity: dimmed ? 0.16 : integrating ? 0.85 : isDependency ? 0.7 : 0.55,
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
      <Handle type="target" position={Position.Left} className="mh-min-node-handle" />
      <Handle type="source" position={Position.Right} className="mh-min-node-handle" />
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
  const { node, selected, branch, onPath, dimmed, isNew, expanding, collapsedChildCount } = data;
  const status = node.vital.status;
  const hasProgress = node.vital.testProgress !== undefined;
  const glyph = nodeGlyph(status);
  const active = status === "planning" || status === "running" || status === "verifying" || status === "repairing";
  const isRoot = node.role === "root";
  const attention = status === "failed" || status === "blocked" || status === "obsolete";

  return (
    <article
      className={[
        "mh-min-node",
        isRoot ? "mh-min-node-root" : "",
        node.isInWavefront ? "mh-min-node-wave" : "",
        selected ? "mh-min-node-selected" : "",
        onPath && !selected ? "mh-min-node-onpath" : "",
        isNew ? "mh-min-node-enter" : "",
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
      <Handle type="target" position={Position.Left} className="mh-min-node-handle" />
      <Handle type="source" position={Position.Right} className="mh-min-node-handle" />
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
      </div>
      <h3>{node.title}</h3>
      <p style={attention ? { color: STATUS_DOT[status], fontWeight: 500 } : undefined}>{node.vital.label}</p>
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
