"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FocusTarget } from "@/lib/run-model/focus-view";
import type { MinimalRunGraph, ProductStage } from "@/lib/run-model/minimal-workspace-view";
import type { WorkspaceNode } from "@/lib/run-model/workspace-view";

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
  [key: string]: unknown;
}

const nodeTypes: NodeTypes = {
  minimalTask: MinimalTaskNode
};

export function MinimalRunGraphCanvas({
  graph,
  stage,
  selectedTarget,
  onFocus
}: MinimalRunGraphProps): React.ReactElement {
  const selectedNodeId = selectedTarget?.kind === "node" ? selectedTarget.id : null;
  const flow = useMemo(() => buildFlow(graph, stage, selectedNodeId), [graph, stage, selectedNodeId]);

  if (graph.nodes.length === 0) {
    return (
      <section className="mh-run-graph mh-run-graph-empty">
        <p>El grafo aparecerá cuando termine la planificación.</p>
      </section>
    );
  }

  return (
    <section className="mh-run-graph" aria-label="Run task graph">
      <ReactFlowProvider>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.16, includeHiddenNodes: false }}
          minZoom={0.45}
          maxZoom={1.45}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_event, node) => onFocus({ kind: "node", id: node.id })}
          onPaneClick={() => undefined}
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(42, 38, 31, 0.12)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </ReactFlowProvider>
    </section>
  );
}

function buildFlow(
  graph: MinimalRunGraph,
  stage: ProductStage,
  selectedNodeId: string | null
): { nodes: Node<MinimalGraphNodeData>[]; edges: Edge[] } {
  const ordered = [...graph.nodes].sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
  const byDepth = new Map<number, WorkspaceNode[]>();
  for (const node of ordered) {
    const bucket = byDepth.get(node.depth) ?? [];
    bucket.push(node);
    byDepth.set(node.depth, bucket);
  }

  const flowNodes: Node<MinimalGraphNodeData>[] = [];
  for (const [depth, nodesAtDepth] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const totalHeight = (nodesAtDepth.length - 1) * 156;
    nodesAtDepth.forEach((node, index) => {
      flowNodes.push({
        id: node.id,
        type: "minimalTask",
        position: { x: depth * 360, y: index * 156 - totalHeight / 2 },
        data: { node, stage, selected: selectedNodeId === node.id }
      });
    });
  }

  const flowEdges: Edge[] = graph.edges.map((edge) => {
    const isDependency = edge.kind === "dependency";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: {
        stroke: isDependency ? "var(--mh-graph-seam)" : "var(--mh-graph-edge)",
        strokeWidth: isDependency ? 1.7 : 1.2,
        strokeDasharray: isDependency ? "4 5" : undefined
      }
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

function MinimalTaskNode({ data }: NodeProps<Node<MinimalGraphNodeData>>): React.ReactElement {
  const { node, stage, selected } = data;
  const status = node.vital.status;
  const hasProgress = node.vital.testProgress !== undefined;
  const muted = node.display === "idle" && stage !== "proposal";

  return (
    <article
      className={[
        "mh-min-node",
        `mh-min-node-${status}`,
        node.isInWavefront ? "mh-min-node-wave" : "",
        selected ? "mh-min-node-selected" : "",
        muted ? "mh-min-node-muted" : ""
      ].filter(Boolean).join(" ")}
    >
      <Handle type="target" position={Position.Left} className="mh-min-node-handle" />
      <Handle type="source" position={Position.Right} className="mh-min-node-handle" />
      <div className="mh-min-node-top">
        <span className="mh-min-node-dot" aria-hidden />
        <span className="mh-min-node-role">{roleLabel(node.role, node.depth)}</span>
      </div>
      <h3>{node.title}</h3>
      <p>{node.vital.label}</p>
      {hasProgress ? (
        <div className="mh-min-node-progress" aria-label={`Tests ${node.vital.testProgress?.pass}/${node.vital.testProgress?.total}`}>
          <span style={{ width: progressWidth(node) }} />
        </div>
      ) : null}
      {node.vital.detail !== undefined && status !== "idle" ? (
        <small>{compactDetail(node.vital.detail)}</small>
      ) : null}
    </article>
  );
}

function roleLabel(role: WorkspaceNode["role"], depth: number): string {
  if (role === "root") return "root";
  if (role === "composite") return `group · d${depth}`;
  return `task · d${depth}`;
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
