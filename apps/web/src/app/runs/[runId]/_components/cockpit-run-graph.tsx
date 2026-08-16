"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { RunModel } from "@/lib/run-model/types";
import { layoutRunTree } from "@/lib/run-model/tree-layout";
import { initialViewport, layoutRunFlow, nextLayoutOffset, offsetPositions, type FlowBand } from "@/lib/run-model/flow-layout";
import type { RunGraphView } from "@/lib/run-model/graph-view";
import {
  buildRelationViews,
  relationNeighborhood,
  type GraphLens,
  type GraphRelationKind,
  type GraphRelationView
} from "@/lib/run-model/presentation";
import { activatedNodeId, graphNodeAccessibleName } from "@/lib/run-model/graph-keyboard";
import { affectedSubgraphNodeIds, lifecycleMedalForNode, relationDisplayName } from "./cockpit-state";
import { fallbackStatus } from "./task-node-v2";
import { InteractiveRelationEdge, type InteractiveRelationEdgeData } from "./InteractiveRelationEdge";
import { TaskNodeV2, type TaskNodeV2FlowNode } from "./task-node-v2";
import { FlowBandNode, type FlowBandFlowNode } from "./flow-band-node";

type Decision = NonNullable<RunModel["projection"]>["decisions"][string];

const nodeTypes: NodeTypes = { taskNodeV2: TaskNodeV2, flowBand: FlowBandNode };

/**
 * The two layouts answer different questions, so the control names the
 * question rather than the drawing. "Tree / graph" would name the shape; what
 * the operator picks is what they want to know.
 */
type GraphArrangement = "ownership" | "flow";
const ARRANGEMENTS: ReadonlyArray<{ value: GraphArrangement; label: string; hint: string }> = [
  { value: "ownership", label: "Pertenencia", hint: "Cómo se descompone el objetivo" },
  { value: "flow", label: "Flujo", hint: "Qué puede ejecutarse a la vez" }
];
const NODE_WIDTH = 246;
const DEFAULT_ZOOM = 0.84;
const NODE_HEIGHT = 132;
const BAND_PADDING_X = 104;
const BAND_PADDING_Y = 30;
const edgeTypes: EdgeTypes = { interactiveRelation: InteractiveRelationEdge };
/**
 * The lens names what the operator wants to see, not the type that carries it.
 * `ArtifactRequirement` and `SeamBinding` are canonical vocabulary and belong
 * in the inspector, where the contract itself is on screen.
 *
 * Conflicts are gone rather than renamed: Stage 9 replaced pairwise conflict
 * constraints with resource claims, so a canonical graph has none and the lens
 * could only ever be empty.
 */
const LENSES: ReadonlyArray<{ value: GraphLens; label: string }> = [
  { value: "execution", label: "Ejecución" },
  { value: "artifact", label: "Entregas" },
  { value: "contract", label: "Contratos" },
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
  const [arrangement, setArrangement] = useState<GraphArrangement>("ownership");
  const { getViewport, setViewport } = useReactFlow();
  // Applied to whichever arrangement is active, so a switch can keep the anchor
  // node exactly where it was without touching the camera.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const { nodes, edges, positions } = useMemo(
    () => graphElements(model, selectedNodeId, lens, arrangement, offset, pendingDecisions, onOpenDecision),
    [arrangement, lens, model, offset, onOpenDecision, pendingDecisions, selectedNodeId]
  );
  positionsRef.current = positions;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const placedRef = useRef(false);

  /**
   * Switching layout moves every node, so without an anchor the node the
   * operator was reading leaves the screen. The camera translates — no zoom, no
   * fit — so the anchor stays under the same pixel.
   *
   * This is not the auto-fitView the interaction model forbids: that rule is
   * about the camera moving in response to SERVER events. Here the operator
   * caused the move, and its effect is to preserve their frame of reference.
   */
  const changeArrangement = useCallback((next: GraphArrangement) => {
    if (next === arrangement) return;
    const anchorId = selectedNodeId ?? nearestNodeId(positionsRef.current, getViewport());
    setOffset((current) => nextLayoutOffset(
      current,
      anchorId === undefined ? undefined : positionsRef.current.get(anchorId),
      anchorId === undefined ? undefined : positionsFor(model, next).get(anchorId)
    ));
    setArrangement(next);
  }, [arrangement, getViewport, model, selectedNodeId]);

  /**
   * Open with the root in the middle of the pane. The canvas used a constant
   * camera, so a run opened with its graph against the left edge.
   *
   * Once, guarded by a ref: this must never become a camera that moves when the
   * server says something, which is the behaviour the interaction model forbids.
   */
  useEffect(() => {
    if (placedRef.current) return;
    const rootId = model.graph?.rootId;
    const placement = initialViewport({
      ...(rootId === undefined ? {} : { root: positionsRef.current.get(rootId) }),
      containerWidth: wrapperRef.current?.clientWidth ?? 0,
      nodeWidth: NODE_WIDTH,
      zoom: DEFAULT_ZOOM
    });
    if (placement === null) return;
    placedRef.current = true;
    setViewport(placement);
  }, [model.graph?.rootId, nodes.length, setViewport]);

  if (nodes.length === 0) {
    return <div className="grid h-full min-h-[420px] place-items-center text-sm text-[var(--color-text-muted)]">Preparando el primer nodo…</div>;
  }

  return (
    <div
      ref={wrapperRef}
      className="h-full min-h-[420px]"
      onKeyDown={(event) => {
        // React Flow puts every node in the tab order and never activates one.
        const activated = activatedNodeId({ key: event.key, target: event.target as Element | null });
        if (activated === null) return;
        event.preventDefault();
        onSelectNode(activated);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={{ x: 84, y: 110, zoom: DEFAULT_ZOOM }}
        onPaneClick={() => onSelectNode(null)}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        minZoom={0.25}
        maxZoom={1.8}
        defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-border)" />
        <Panel position="top-left" className="flex flex-col gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 p-1.5 shadow-sm backdrop-blur motion-reduce:backdrop-blur-none" aria-label="Controles del grafo">
          <div className="flex gap-1" role="group" aria-label="Disposición del grafo">
            {ARRANGEMENTS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={arrangement === option.value}
                title={option.hint}
                onClick={() => changeArrangement(option.value)}
                className="rounded-md px-2 py-1.5 text-micro font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] aria-pressed:bg-[var(--color-accent)] aria-pressed:text-[var(--color-accent-contrast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {option.label}
                <span className="sr-only"> — {option.hint}</span>
              </button>
            ))}
          </div>
          <div className="flex max-w-[min(76vw,820px)] flex-wrap gap-1 border-t border-[var(--color-border-soft)] pt-1.5" role="group" aria-label="Relaciones visibles">
            {LENSES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={lens === option.value}
                onClick={() => setLens(option.value)}
                className="rounded-md px-2 py-1.5 text-micro font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] aria-pressed:bg-[var(--color-accent)] aria-pressed:text-[var(--color-accent-contrast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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

/**
 * Levels derived from the graph the operator is looking at.
 *
 * The compiled node carries its level, but a revision from before stage 4 does
 * not, and a fixture may never have had one. Deriving here means the flow
 * arrangement is correct for every revision, and it cannot drift from the
 * compiled value because it is the same function.
 *
 * A cycle yields nothing rather than throwing: the plan critics own that
 * diagnosis, and a layout must never be what takes the workspace down.
 */
/**
 * Bands come from the artifact dependencies the graph declares: a node sits one
 * level below the last artifact it consumes. A canonical revision carries no
 * `topologicalLevel`, and banding every node together under "no dependencies"
 * would state something false about a graph that plainly has them.
 */
function levelResolver(graph: RunGraphView): (nodeId: string) => number | undefined {
  const producers = new Map<string, string[]>();
  for (const edge of graph.artifactEdges) {
    producers.set(edge.consumerNodeId, [...(producers.get(edge.consumerNodeId) ?? []), edge.producerNodeId]);
  }
  const levels = new Map<string, number>();
  const levelOf = (nodeId: string, seen: ReadonlySet<string>): number => {
    const cached = levels.get(nodeId);
    if (cached !== undefined) return cached;
    if (seen.has(nodeId)) return 0;
    const upstream = producers.get(nodeId) ?? [];
    const level = upstream.length === 0
      ? 0
      : Math.max(...upstream.map((producer) => levelOf(producer, new Set([...seen, nodeId])) + 1));
    levels.set(nodeId, level);
    return level;
  };
  return (nodeId) => (graph.nodes[nodeId] === undefined ? undefined : levelOf(nodeId, new Set()));
}

/** Positions alone, so the anchor can be measured before committing a switch. */
function positionsFor(model: RunModel, arrangement: GraphArrangement): Map<string, { x: number; y: number }> {
  if (model.graph === null) return new Map();
  return arrangement === "flow"
    ? layoutRunFlow(model.nodes, levelResolver(model.graph)).positions
    : layoutRunTree(model.graph.rootId, model.nodes);
}

function graphElements(
  model: RunModel,
  selectedNodeId: string | null,
  lens: GraphLens,
  arrangement: GraphArrangement,
  offset: { x: number; y: number },
  pendingDecisions: readonly Decision[],
  onOpenDecision: (decisionId: string) => void
): { nodes: (TaskNodeV2FlowNode | FlowBandFlowNode)[]; edges: Edge[]; positions: Map<string, { x: number; y: number }> } {
  if (model.graph === null) return { nodes: [], edges: [], positions: new Map() };
  const relations = buildRelationViews(model.graph, lens, selectedNodeId);
  const neighborhood = relationNeighborhood(relations, selectedNodeId);
  const flow = arrangement === "flow" ? layoutRunFlow(model.nodes, levelResolver(model.graph)) : undefined;
  const positions = offsetPositions(flow?.positions ?? layoutRunTree(model.graph.rootId, model.nodes), offset);
  const attempts = model.projection === null ? [] : Object.values(model.projection.attempts);
  const integrations = model.projection === null ? [] : Object.values(model.projection.integrations);
  const blockedByDecision = pendingDecisions.map((decision) => ({
    id: decision.id,
    nodes: affectedSubgraphNodeIds(model.nodes, decision.affectedNodeIds)
  }));

  const taskNodes: TaskNodeV2FlowNode[] = model.nodes.map((node) => {
    const decisionIds = blockedByDecision.filter((decision) => decision.nodes.has(node.id)).map((decision) => decision.id);
    const medal = lifecycleMedalForNode({
      nodeId: node.id,
      attempts,
      integrations,
      evidenceMatrixId: model.projection?.nodeEvidenceMatrixIds[node.id],
      evidenceMatrices: model.evidenceMatrices,
      delivered: model.run.lifecycle === "completed"
    });
    return {
      id: node.id,
      type: "taskNodeV2",
      // React Flow renders the focusable wrapper, so the name has to live on
      // the node object: an unnamed `role="group"` is what a keyboard user
      // reached before.
      ariaLabel: graphNodeAccessibleName({
        title: node.title,
        kind: node.kind,
        status: medal.badge.length === 0 ? fallbackStatus(node.status) : medal.badge,
        ...(flow === undefined || node.topologicalLevel === undefined
          ? {}
          : { bandLevel: node.topologicalLevel })
      }),
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        node,
        medal,
        selected: selectedNodeId === node.id,
        dimmed: selectedNodeId !== null && !neighborhood.has(node.id),
        blocked: decisionIds.length > 0,
        decisionIds,
        onOpenDecision
      }
    };
  });
  const edges = relations.map((relation) => relationEdge(relation, model));
  // Bands render behind the nodes and are inert: not draggable, not selectable,
  // and never a click target, so they cannot steal a selection.
  const bandNodes: FlowBandFlowNode[] = flow === undefined ? [] : bandBackdrops(flow.bands, offset);
  return { nodes: [...bandNodes, ...taskNodes], edges, positions };
}

function bandBackdrops(bands: readonly FlowBand[], offset: { x: number; y: number }): FlowBandFlowNode[] {
  const widest = Math.max(1, ...bands.map((band) => band.count));
  const width = widest * NODE_WIDTH + (widest - 1) * 30 + BAND_PADDING_X * 2;
  const height = NODE_HEIGHT + BAND_PADDING_Y * 2;
  return bands.map((band) => ({
    id: `band-${band.level}`,
    type: "flowBand" as const,
    position: { x: -width / 2 + offset.x, y: band.y - BAND_PADDING_Y + offset.y },
    data: { level: band.level, count: band.count, width, height },
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
    zIndex: -1
  }));
}

/** The node nearest the middle of the screen, used as the anchor when nothing is selected. */
function nearestNodeId(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  viewport: { x: number; y: number; zoom: number }
): string | undefined {
  if (positions.size === 0) return undefined;
  const centre = typeof window === "undefined"
    ? { x: 0, y: 0 }
    : {
        x: (window.innerWidth / 2 - viewport.x) / viewport.zoom,
        y: (window.innerHeight / 2 - viewport.y) / viewport.zoom
      };
  let best: { id: string; distance: number } | undefined;
  for (const [id, position] of positions) {
    const distance = (position.x - centre.x) ** 2 + (position.y - centre.y) ** 2;
    if (best === undefined || distance < best.distance) best = { id, distance };
  }
  return best?.id;
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
