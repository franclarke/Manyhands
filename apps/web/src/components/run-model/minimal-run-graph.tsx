"use client";

import { useEffect, useMemo } from "react";
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
  [key: string]: unknown;
}

const X_GAP = 296;
const Y_GAP = 150;
const BRANCH_VARS = [
  "var(--mh-branch-1)",
  "var(--mh-branch-2)",
  "var(--mh-branch-3)",
  "var(--mh-branch-4)",
  "var(--mh-branch-5)",
  "var(--mh-branch-6)"
];

const nodeTypes: NodeTypes = {
  minimalTask: MinimalTaskNode
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
  const flow = useMemo(() => buildFlow(graph, stage, selectedNodeId), [graph, stage, selectedNodeId]);
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
        onNodeClick={(_event, node) => onFocus({ kind: "node", id: node.id })}
        onPaneClick={() => undefined}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="var(--mh-graph-dots)" />
        <CanvasControls />
        <FitViewOnGrowth count={flow.nodes.length} />
        {graph.nodes.length === 0 ? (
          <div className="mh-run-graph-planning-chip" aria-live="polite">
            <span className="mh-live mh-live-on">planificando</span>
            <small>Esperando primer nodo</small>
          </div>
        ) : null}
      </ReactFlow>
    </section>
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
  selectedNodeId: string | null
): { nodes: Node<MinimalGraphNodeData>[]; edges: Edge[] } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, WorkspaceNode[]>();
  for (const node of graph.nodes) {
    if (node.parentId !== null && byId.has(node.parentId)) {
      const bucket = childrenOf.get(node.parentId) ?? [];
      bucket.push(node);
      childrenOf.set(node.parentId, bucket);
    }
  }
  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }

  // Branch identity: the top-level ancestor (a direct child of the root) owns a
  // colour; the root is neutral; descendants inherit their branch's colour.
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
    return BRANCH_VARS[branchKeys.indexOf(key) % BRANCH_VARS.length]!;
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
  const roots = graph.nodes
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

  const flowNodes: Node<MinimalGraphNodeData>[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "minimalTask",
    position: pos.get(node.id) ?? { x: node.depth * X_GAP, y: 0 },
    data: {
      node,
      stage,
      selected: selectedNodeId === node.id,
      branch: branchColorFor(node),
      onPath: pathSet.has(node.id),
      dimmed: hasSelection && !pathSet.has(node.id)
    }
  }));

  const flowEdges: Edge[] = graph.edges.map((edge) => {
    const isDependency = edge.kind === "dependency";
    const target = byId.get(edge.target);
    const onPath = !isDependency && pathSet.has(edge.source) && pathSet.has(edge.target);
    const dimmed = hasSelection && !onPath;
    const branchColor = target !== undefined ? branchColorFor(target) : "var(--mh-graph-edge)";
    const stroke = isDependency ? "var(--mh-graph-seam)" : branchColor;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: onPath,
      markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: stroke },
      style: {
        stroke,
        strokeWidth: onPath ? 2.4 : isDependency ? 1.6 : 1.4,
        strokeDasharray: isDependency ? "4 5" : undefined,
        opacity: dimmed ? 0.16 : isDependency ? 0.85 : 0.6,
        transition: "opacity 200ms ease, stroke-width 200ms ease"
      }
    };
  });

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

function MinimalTaskNode({ data }: NodeProps<Node<MinimalGraphNodeData>>): React.ReactElement {
  const { node, selected, branch, onPath, dimmed } = data;
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
        onPath && !selected ? "mh-min-node-onpath" : ""
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
