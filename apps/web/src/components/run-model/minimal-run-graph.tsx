"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
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
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import type { FocusTarget } from "@/lib/run-model/focus-view";
import type { MinimalRunGraph, ProductStage } from "@/lib/run-model/minimal-workspace-view";
import type { VitalStatus, WorkspaceNode } from "@/lib/run-model/workspace-view";

interface MinimalRunGraphProps {
  graph: MinimalRunGraph;
  stage: ProductStage;
  selectedTarget: FocusTarget | null;
  onFocus: (target: FocusTarget) => void;
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
  [key: string]: unknown;
}

interface SkeletonGraphNodeData {
  dimmed: boolean;
  [key: string]: unknown;
}

const X_GAP = 296;
const Y_GAP = 150;
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

function CanvasControls(): React.ReactElement {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div className="absolute bottom-4 right-4 flex gap-1.5 p-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.02)] z-30 select-none">
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
  onFocus
}: MinimalRunGraphProps): React.ReactElement {
  const selectedNodeId = selectedTarget?.kind === "node" ? selectedTarget.id : null;
  // Ids already on canvas — anything beyond this set just streamed in and
  // materializes with the settle entrance instead of popping.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const flow = useMemo(
    () => buildFlow(graph, stage, selectedNodeId, seenIdsRef.current),
    [graph, stage, selectedNodeId]
  );
  useEffect(() => {
    for (const node of flow.nodes) {
      if (!isGhostId(node.id)) seenIdsRef.current.add(node.id);
    }
  }, [flow]);
  return (
    <section className="mh-run-graph" aria-label="Grafo de tareas del run">
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
          onFocus({ kind: "node", id: node.id });
        }}
        onPaneClick={() => undefined}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="var(--mh-graph-dots)" />
        <CanvasControls />
        <FitViewOnGrowth count={flow.nodes.length} />
        {graph.nodes.length === 0 ? <PlanningEmptyState /> : null}
      </ReactFlow>
    </section>
  );
}

function PlanningEmptyState(): React.ReactElement {
  return (
    <div className="mh-run-graph-planning-state" aria-live="polite">
      <div className="mh-planning-root-node">
        <span className="mh-live mh-live-on">Planning</span>
        <strong>Construyendo el grafo</strong>
        <p>ManyHands esta resolviendo el contexto del repo y esperando el primer nodo del plan.</p>
      </div>
      <div className="mh-planning-steps" aria-label="Estado de planning">
        <span>Contexto del workspace</span>
        <span>Primer nodo</span>
        <span>Costuras candidatas</span>
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
  seenIds: ReadonlySet<string>
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

  // Tidy layout: a DFS that packs each subtree into a contiguous vertical band and
  // centres every parent over its children, so siblings sit together and branches
  // never interleave.
  const pos = new Map<string, { x: number; y: number }>();
  let leafCursor = 0;
  const place = (node: WorkspaceNode): number => {
    const kids = childrenOf.get(node.id) ?? [];
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

  const flowNodes: Node<MinimalGraphNodeData | SkeletonGraphNodeData>[] = allNodes.map((node) => {
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
        expanding: isExpanding(node)
      }
    };
  });

  const flowEdges: Edge[] = graph.edges.map((edge) => {
    const isDependency = edge.kind === "dependency";
    const target = byId.get(edge.target);
    const onPath = !isDependency && pathSet.has(edge.source) && pathSet.has(edge.target);
    const dimmed = hasSelection && !onPath;
    // Hierarchy edges into a still-expanding subtree march with the stream.
    const streaming = !isDependency && target !== undefined && isExpanding(target);
    const branchColor = target !== undefined ? branchColorFor(target) : "var(--mh-graph-edge)";
    const stroke = isDependency ? "var(--mh-graph-seam)" : branchColor;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: onPath,
      ...(streaming ? { className: "edge-flow" } : {}),
      markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: stroke },
      style: {
        stroke,
        strokeWidth: onPath ? 2.4 : isDependency ? 1.6 : 1.4,
        strokeDasharray: isDependency ? "4 5" : streaming ? "4 6" : undefined,
        opacity: dimmed ? 0.16 : isDependency ? 0.85 : 0.6,
        transition: "opacity 200ms ease, stroke-width 200ms ease"
      }
    };
  });

  // Parent → ghost: the stream itself, drawn as a marching dashed ember edge.
  for (const ghost of ghosts) {
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
  const { node, selected, branch, onPath, dimmed, isNew, expanding } = data;
  const status = node.vital.status;
  const hasProgress = node.vital.testProgress !== undefined;
  const dotColor = STATUS_DOT[status];
  const active = status === "planning" || status === "running" || status === "verifying" || status === "repairing";

  return (
    <article
      className={[
        "mh-min-node",
        node.isInWavefront ? "mh-min-node-wave" : "",
        selected ? "mh-min-node-selected" : "",
        onPath && !selected ? "mh-min-node-onpath" : "",
        isNew ? "mh-min-node-enter" : "",
        expanding ? "mh-min-node-expanding" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        // The left rail encodes the BRANCH; status lives in the dot + label below.
        ["--branch" as string]: branch,
        borderLeftColor: selected ? "var(--accent)" : branch,
        opacity: dimmed ? 0.34 : 1,
        filter: dimmed ? "saturate(0.55)" : "none"
      }}
    >
      <Handle type="target" position={Position.Left} className="mh-min-node-handle" />
      <Handle type="source" position={Position.Right} className="mh-min-node-handle" />
      <div className="mh-min-node-top">
        <span
          className={active ? "mh-min-node-dot coral-pulse" : "mh-min-node-dot"}
          style={{ background: dotColor, opacity: 1 }}
          aria-hidden
        />
        <span className="mh-min-node-role flex items-center gap-1.5" style={{ color: branch }}>
          {roleLabel(node.role, node.depth)}
          {status === "blocked" && <span className="text-[9px] px-1 bg-[var(--status-blocked-bg)] border border-[var(--status-blocked-border)] text-[var(--status-blocked-fg)] rounded font-semibold lowercase font-mono">bloqueado</span>}
          {status === "failed" && <span className="text-[9px] px-1 bg-[var(--status-failed-bg)] border border-[var(--status-failed-border)] text-[var(--status-failed-fg)] rounded font-semibold lowercase font-mono">fallido</span>}
          {status === "done" && <span className="text-[9px] px-1 bg-[var(--status-completed-bg)] border border-[var(--status-completed-border)] text-[var(--status-completed-fg)] rounded font-semibold lowercase font-mono">completado</span>}
        </span>
      </div>
      <h3>{node.title}</h3>
      <p>{node.vital.label}</p>
      {hasProgress ? (
        <div
          className="mh-min-node-progress"
          aria-label={`Tests ${node.vital.testProgress?.pass}/${node.vital.testProgress?.total}`}
        >
          <span style={{ width: progressWidth(node) }} />
        </div>
      ) : null}
      {node.vital.detail !== undefined && status !== "idle" ? <small>{compactDetail(node.vital.detail)}</small> : null}
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
