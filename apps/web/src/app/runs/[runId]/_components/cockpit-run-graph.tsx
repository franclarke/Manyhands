"use client";

import { useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeTypes,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { RunModel } from "@/lib/run-model/types";
import { layoutRunTree } from "@/lib/run-model/tree-layout";
import {
  buildRelationViews,
  relationNeighborhood,
  type GraphLens,
  type GraphRelationKind,
  type GraphRelationView
} from "@/lib/run-model/presentation";
import { affectedSubgraphNodeIds, lifecycleMedalForNode, relationDisplayName } from "./cockpit-state";
import { InteractiveRelationEdge, type InteractiveRelationEdgeData } from "./InteractiveRelationEdge";
import { TaskNodeV2, type TaskNodeV2FlowNode } from "./task-node-v2";

type Decision = NonNullable<RunModel["projection"]>["decisions"][string];

const nodeTypes: NodeTypes = { taskNodeV2: TaskNodeV2 };
const edgeTypes: EdgeTypes = { interactiveRelation: InteractiveRelationEdge };
const LENSES: ReadonlyArray<{ value: GraphLens; label: string }> = [
  { value: "execution", label: "Ejecución" },
  { value: "artifact", label: "ArtifactRequirement" },
  { value: "contract", label: "SeamBinding" },
  { value: "conflict", label: "ConflictConstraint" },
  { value: "all", label: "Todas" }
];

export function CockpitRunGraph(props: {
  model: RunModel;
  selectedNodeId: string | null;
  pendingDecisions: readonly Decision[];
  onSelectNode: (nodeId: string | null) => void;
  onOpenDecision: (decisionId: string) => void;
}): React.ReactElement {
  return <ReactFlowProvider><CockpitRunGraphInner {...props} /></ReactFlowProvider>;
}

function CockpitRunGraphInner({
  model,
  selectedNodeId,
  pendingDecisions,
  onSelectNode,
  onOpenDecision
}: {
  model: RunModel;
  selectedNodeId: string | null;
  pendingDecisions: readonly Decision[];
  onSelectNode: (nodeId: string | null) => void;
  onOpenDecision: (decisionId: string) => void;
}): React.ReactElement {
  const [lens, setLens] = useState<GraphLens>("execution");
  const { nodes, edges } = useMemo(
    () => graphElements(model, selectedNodeId, lens, pendingDecisions, onOpenDecision),
    [lens, model, onOpenDecision, pendingDecisions, selectedNodeId]
  );

  if (nodes.length === 0) {
    return <div className="grid h-full min-h-[420px] place-items-center text-sm text-[var(--color-text-muted)]">Preparando el primer nodo…</div>;
  }

  return (
    <div className="h-full min-h-[420px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={{ x: 84, y: 110, zoom: 0.84 }}
        onPaneClick={() => onSelectNode(null)}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        minZoom={0.25}
        maxZoom={1.8}
        defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-border)" />
        <Panel position="top-left" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 p-1.5 shadow-sm backdrop-blur motion-reduce:backdrop-blur-none" aria-label="Lentes del grafo">
          <div className="flex max-w-[min(76vw,820px)] flex-wrap gap-1" role="group" aria-label="Relaciones visibles">
            {LENSES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={lens === option.value}
                onClick={() => setLens(option.value)}
                className="rounded-md px-2 py-1.5 text-micro font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] aria-pressed:bg-[var(--color-accent)] aria-pressed:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {option.label}
              </button>
            ))}
          </div>
        </Panel>
        <Controls showFitView={false} showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

function graphElements(
  model: RunModel,
  selectedNodeId: string | null,
  lens: GraphLens,
  pendingDecisions: readonly Decision[],
  onOpenDecision: (decisionId: string) => void
): { nodes: TaskNodeV2FlowNode[]; edges: Edge[] } {
  if (model.graph === null) return { nodes: [], edges: [] };
  const relations = buildRelationViews(model.graph, lens, selectedNodeId);
  const neighborhood = relationNeighborhood(relations, selectedNodeId);
  const positions = layoutRunTree(model.graph.rootId, model.nodes);
  const attempts = model.projection === null ? [] : Object.values(model.projection.attempts);
  const integrations = model.projection === null ? [] : Object.values(model.projection.integrations);
  const blockedByDecision = pendingDecisions.map((decision) => ({
    id: decision.id,
    nodes: affectedSubgraphNodeIds(model.nodes, decision.affectedNodeIds)
  }));

  const nodes: TaskNodeV2FlowNode[] = model.nodes.map((node) => {
    const decisionIds = blockedByDecision.filter((decision) => decision.nodes.has(node.id)).map((decision) => decision.id);
    return {
      id: node.id,
      type: "taskNodeV2",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        node,
        medal: lifecycleMedalForNode({
          nodeId: node.id,
          attempts,
          integrations,
          evidenceMatrices: model.evidenceMatrices,
          delivered: model.run.lifecycle === "completed"
        }),
        selected: selectedNodeId === node.id,
        dimmed: selectedNodeId !== null && !neighborhood.has(node.id),
        blocked: decisionIds.length > 0,
        decisionIds,
        onOpenDecision
      }
    };
  });
  const edges = relations.map((relation) => relationEdge(relation, model));
  return { nodes, edges };
}

function relationEdge(relation: GraphRelationView, model: RunModel): Edge<InteractiveRelationEdgeData> {
  const visual = relationVisual(relation.kind);
  return {
    id: relation.id,
    source: relation.source,
    target: relation.target,
    sourceHandle: "source",
    targetHandle: "target",
    type: "interactiveRelation",
    animated: false,
    ariaLabel: `${relationDisplayName(relation.kind)}: ${nodeTitle(model, relation.source)} a ${nodeTitle(model, relation.target)}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: visual.stroke },
    style: {
      stroke: visual.stroke,
      strokeWidth: visual.width,
      ...(visual.dash === undefined ? {} : { strokeDasharray: visual.dash })
    },
    data: {
      relation,
      contracts: model.contracts,
      sourceTitle: nodeTitle(model, relation.source),
      targetTitle: nodeTitle(model, relation.target)
    }
  };
}

function relationVisual(kind: GraphRelationKind): { stroke: string; width: number; dash?: string } {
  switch (kind) {
    case "artifact": return { stroke: "var(--color-accent)", width: 2.2 };
    case "contract": return { stroke: "var(--status-review-fg)", width: 2.2, dash: "6 4" };
    case "conflict": return { stroke: "var(--status-failed-fg)", width: 2.2, dash: "2 5" };
    default: return { stroke: "var(--color-border-strong)", width: 1.3 };
  }
}

function nodeTitle(model: RunModel, nodeId: string): string {
  return model.nodes.find((node) => node.id === nodeId)?.title ?? nodeId;
}
