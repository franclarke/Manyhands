"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { NodeExecutionStatus, RunModel, RunNodeView } from "@/lib/run-model/types";
import { layoutRunTree } from "@/lib/run-model/tree-layout";
import {
  bundledArtifactDeliveries,
  buildRelationViews,
  relationLaneOffset,
  relationNeighborhood,
  type GraphLens,
  type GraphRelationDetail,
  type GraphRelationKind,
  type GraphRelationView
} from "@/lib/run-model/presentation";

interface RunGraphCanvasProps {
  model: RunModel;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  autoFit: boolean;
  onAutoFitChange: (enabled: boolean) => void;
}

interface TaskCardData extends Record<string, unknown> {
  node: RunNodeView;
  selected: boolean;
  dimmed: boolean;
  bundledDeliveries: number;
  enterDelayMs: number;
}

interface RelationEdgeData extends Record<string, unknown> {
  relation: GraphRelationView;
  sourceTitle: string;
  targetTitle: string;
  laneOffset: number;
  ariaLabel: string;
}

type RelationFlowEdge = Edge<RelationEdgeData, "relation">;

const LENS_OPTIONS: ReadonlyArray<{ value: GraphLens; label: string }> = [
  { value: "execution", label: "Ejecución" },
  { value: "artifact", label: "Artefactos" },
  { value: "contract", label: "Contratos" },
  { value: "conflict", label: "Conflictos" },
  { value: "all", label: "Todo" }
];

const nodeTypes: NodeTypes = { taskCard: TaskCard };
const edgeTypes: EdgeTypes = { relation: RelationEdge };
const EDGE_TOOLTIP_DELAY_MS = 2_000;

export function RunGraphCanvas(props: RunGraphCanvasProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <RunGraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function RunGraphCanvasInner({ model, selectedNodeId, onSelectNode, autoFit, onAutoFitChange }: RunGraphCanvasProps): React.ReactElement {
  const flow = useReactFlow();
  const initializedViewport = useRef(false);
  const [lens, setLens] = useState<GraphLens>("execution");
  const [showMiniMap, setShowMiniMap] = useState(false);
  const { nodes, edges } = useMemo(() => graphElements(model, selectedNodeId, lens), [lens, model, selectedNodeId]);
  const graphStructureKey = useMemo(() => JSON.stringify(model.nodes.map((node) => node.id)), [model.nodes]);
  const relationCounts = relationCountsFor(model);

  function initializeViewport(): void {
    if (initializedViewport.current) return;
    initializedViewport.current = true;
    window.requestAnimationFrame(() => {
      void flow.setCenter(115, 330, { zoom: 0.85 });
    });
  }

  const fitGraph = useCallback((): void => {
    void flow.fitView({ padding: 0.18, maxZoom: 1, duration: 200 });
  }, [flow]);

  useEffect(() => {
    if (!autoFit || !initializedViewport.current) return;
    const frame = window.requestAnimationFrame(fitGraph);
    return () => window.cancelAnimationFrame(frame);
  }, [autoFit, fitGraph, graphStructureKey]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center text-center text-sm text-[var(--color-text-muted)]">
        <div><span className="mb-2 block text-2xl">◇</span>Preparando el primer nodo…</div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-[420px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={initializeViewport}
        onPaneClick={() => onSelectNode(null)}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        minZoom={0.25}
        maxZoom={1.8}
        defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-border)" />
        <Panel position="top-left" className="mh-graph-toolbar" aria-label="Lentes del grafo">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Relaciones visibles">
            {LENS_OPTIONS.map((option) => {
              const count = option.value === "execution" ? null : relationCounts[option.value];
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={lens === option.value}
                  onClick={() => setLens(option.value)}
                  className="mh-graph-lens"
                >
                  {option.label}{count === null ? null : <span className="tabular-nums text-[var(--color-text-subtle)]"> {count}</span>}
                </button>
              );
            })}
          </div>
          <div className="mh-graph-toolbar-actions">
            <AutoFitSwitch autoFit={autoFit} onAutoFitChange={onAutoFitChange} />
            <button type="button" onClick={fitGraph} className="mh-graph-tool-button">Encuadrar</button>
            {nodes.length > 6 ? (
              <button
                type="button"
                aria-pressed={showMiniMap}
                onClick={() => setShowMiniMap((visible) => !visible)}
                className="mh-graph-tool-button"
              >
                {showMiniMap ? "Ocultar mapa" : "Mostrar mapa"}
              </button>
            ) : null}
          </div>
          {lens === "execution" ? (
            <p className="mh-graph-toolbar-hint">Seleccioná un nodo para revelar sus relaciones.</p>
          ) : null}
        </Panel>
        {showMiniMap && nodes.length > 6 ? (
          <MiniMap pannable zoomable nodeColor={(node) => statusColor((node.data as TaskCardData).node.status)} />
        ) : null}
        <Controls showFitView={false} showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

function AutoFitSwitch({
  autoFit,
  onAutoFitChange
}: {
  autoFit: boolean;
  onAutoFitChange: (enabled: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={autoFit}
      aria-label="Autoencuadrar al agregar nodos"
      onClick={() => onAutoFitChange(!autoFit)}
      className="mh-graph-auto-fit"
    >
      <span>Autoencuadre</span>
      <span className="mh-graph-auto-fit-track" aria-hidden>
        <span className="mh-graph-auto-fit-thumb" />
      </span>
    </button>
  );
}

function TaskCard({ data }: NodeProps<Node<TaskCardData, "taskCard">>): React.ReactElement {
  const { node, selected, dimmed, bundledDeliveries, enterDelayMs } = data;
  const integrationClass = node.integrationStatus === "running"
    ? "mh-graph-node-integrating"
    : node.integrationStatus === "completed" ? "mh-graph-node-integrated" : "";
  return (
    <div
      className={`mh-graph-node-enter relative w-[230px] rounded-xl border bg-[var(--color-surface-raised)] px-4 py-3 shadow-sm transition-[border-color,box-shadow,opacity,transform] duration-200 ${integrationClass}`}
      style={{
        borderColor: selected ? "var(--color-accent)" : statusColor(node.status),
        boxShadow: selected ? "0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent)" : undefined,
        opacity: dimmed ? 0.28 : 1,
        animationDelay: `${enterDelayMs}ms`
      }}
    >
      <Handle id="hierarchy-target" type="target" position={Position.Top} className="mh-graph-handle" />
      <Handle id="hierarchy-source" type="source" position={Position.Bottom} className="mh-graph-handle" />
      <Handle id="artifact-source" type="source" position={Position.Bottom} className="mh-graph-handle" style={{ left: "24%" }} />
      <Handle id="artifact-target" type="target" position={Position.Bottom} className="mh-graph-handle" style={{ left: "76%" }} />
      <Handle id="contract-source" type="source" position={Position.Bottom} className="mh-graph-handle" style={{ left: "38%" }} />
      <Handle id="contract-target" type="target" position={Position.Bottom} className="mh-graph-handle" style={{ left: "62%" }} />
      <Handle id="conflict-source" type="source" position={Position.Bottom} className="mh-graph-handle" style={{ left: "52%" }} />
      <Handle id="conflict-target" type="target" position={Position.Bottom} className="mh-graph-handle" style={{ left: "48%" }} />
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">{node.kind}</span>
        <span className="flex items-center gap-1.5 text-eyebrow font-medium uppercase tracking-wide" style={{ color: statusColor(node.status) }}>
          <span className={node.status === "running" ? "mh-status-pulse size-1.5 rounded-full bg-current" : "size-1.5 rounded-full bg-current"} />
          {statusLabel(node.status)}
        </span>
      </div>
      <strong className="block text-label leading-5 text-[var(--color-text)]">{node.title}</strong>
      <p className="mt-1 line-clamp-2 text-micro leading-4 text-[var(--color-text-muted)]">{node.goal}</p>
      {(node.artifactCount > 0 || node.decisionCount > 0) ? (
        <div className="mt-2 flex gap-2 text-eyebrow text-[var(--color-text-subtle)]">
          {node.artifactCount > 0 ? <span>{node.artifactCount} artefacto{node.artifactCount === 1 ? "" : "s"}</span> : null}
          {node.decisionCount > 0 ? <span>{node.decisionCount} decisión</span> : null}
        </div>
      ) : null}
      {bundledDeliveries > 0 ? (
        <span className="mt-2 block text-eyebrow text-[var(--color-text-subtle)]">{bundledDeliveries} entregable{bundledDeliveries === 1 ? "" : "s"} al objetivo</span>
      ) : null}
    </div>
  );
}

function graphElements(model: RunModel, selectedNodeId: string | null, lens: GraphLens): { nodes: Array<Node<TaskCardData, "taskCard">>; edges: Edge[] } {
  if (model.graph === null) return { nodes: [], edges: [] };
  const graph = model.graph;
  const positions = layoutRunTree(graph.rootId, model.nodes);
  const relations = buildRelationViews(graph, lens, selectedNodeId);
  const neighborhood = relationNeighborhood(relations, selectedNodeId);
  const nodes: Array<Node<TaskCardData, "taskCard">> = model.nodes.map((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    const depth = Math.max(0, Math.round(position.y / 190));
    const siblingIndex = node.layout?.siblingIndex ?? 0;
    return {
      id: node.id,
      type: "taskCard",
      position,
      data: {
        node,
        selected: selectedNodeId === node.id,
        dimmed: selectedNodeId !== null && !neighborhood.has(node.id),
        bundledDeliveries: bundledArtifactDeliveries(graph, node.id),
        enterDelayMs: Math.min(120, depth * 20 + siblingIndex * 12)
      }
    };
  });
  const edges = relations.map((relation) => relationEdge(relation, model.nodes, selectedNodeId));
  return { nodes, edges };
}

function relationEdge(relation: GraphRelationView, nodes: readonly RunNodeView[], selectedNodeId: string | null): Edge {
  const visual = relationVisual(relation.kind);
  const connected = selectedNodeId === null || relation.source === selectedNodeId || relation.target === selectedNodeId;
  const activeArtifact = relation.kind === "artifact"
    && connected
    && selectedNodeId !== null
    && nodes.some((node) => (node.id === relation.source || node.id === relation.target) && node.status === "running");
  const ariaLabel = relationAriaLabel(relation, nodes);
  const edge: Edge = {
    id: relation.id,
    source: relation.source,
    target: relation.target,
    sourceHandle: visual.sourceHandle,
    targetHandle: visual.targetHandle,
    type: visual.edgeType,
    animated: activeArtifact,
    ariaLabel,
    zIndex: connected ? 2 : 0,
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: visual.stroke },
    style: {
      stroke: visual.stroke,
      strokeWidth: connected ? visual.strokeWidth : 1,
      strokeDasharray: visual.strokeDasharray,
      opacity: connected ? 1 : 0.14
    },
    data: {
      relation,
      sourceTitle: nodeTitle(nodes, relation.source),
      targetTitle: nodeTitle(nodes, relation.target),
      laneOffset: relationLaneOffset(relation.kind),
      ariaLabel
    }
  };
  return edge;
}

function relationVisual(kind: GraphRelationKind): {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string | undefined;
  edgeType: "smoothstep" | "relation";
  sourceHandle: string;
  targetHandle: string;
} {
  switch (kind) {
    case "artifact": return {
      stroke: "var(--color-accent)",
      strokeWidth: 1.8,
      edgeType: "relation",
      sourceHandle: "artifact-source",
      targetHandle: "artifact-target"
    };
    case "contract": return {
      stroke: "var(--status-review-fg)",
      strokeWidth: 1.5,
      strokeDasharray: "5 4",
      edgeType: "relation",
      sourceHandle: "contract-source",
      targetHandle: "contract-target"
    };
    case "conflict": return {
      stroke: "var(--error)",
      strokeWidth: 1.5,
      strokeDasharray: "2 5",
      edgeType: "relation",
      sourceHandle: "conflict-source",
      targetHandle: "conflict-target"
    };
    default: return {
      stroke: "var(--color-border-strong)",
      strokeWidth: 1.2,
      edgeType: "smoothstep",
      sourceHandle: "hierarchy-source",
      targetHandle: "hierarchy-target"
    };
  }
}

function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
  style
}: EdgeProps<RelationFlowEdge>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const focused = useRef(false);
  const laneY = Math.max(sourceY, targetY) + (data?.laneOffset ?? 18);
  const path = relationLanePath(sourceX, sourceY, targetX, targetY, laneY);
  const tooltipId = `edge-tooltip-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
  }, []);

  function scheduleOpen(): void {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setOpen(true);
    }, EDGE_TOOLTIP_DELAY_MS);
  }

  function closeFromPointer(): void {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (!focused.current) setOpen(false);
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={0}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        {...(style === undefined ? {} : { style })}
      />
      <path
        d={path}
        className="mh-relation-edge-hitbox"
        tabIndex={0}
        role="img"
        aria-label={data?.ariaLabel}
        aria-describedby={open ? tooltipId : undefined}
        onPointerEnter={scheduleOpen}
        onPointerLeave={closeFromPointer}
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
        }}
      />
      {open && data ? (
        <EdgeLabelRenderer>
          <div
            id={tooltipId}
            role="tooltip"
            className="mh-edge-tooltip nodrag nopan"
            style={{ transform: `translate(-50%, -100%) translate(${(sourceX + targetX) / 2}px, ${laneY - 10}px)` }}
          >
            <div className="mh-edge-tooltip-eyebrow">
              {relationKindLabel(data.relation.kind)}
              {data.relation.relationCount > 1 ? ` · ${data.relation.relationCount}` : ""}
            </div>
            <strong>{data.sourceTitle} {data.relation.kind === "conflict" ? "↔" : "→"} {data.targetTitle}</strong>
            <div className="mh-edge-tooltip-details">
              {data.relation.details.map((detail) => <RelationDetail key={detail.id} detail={detail} />)}
            </div>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function RelationDetail({ detail }: { detail: GraphRelationDetail }): React.ReactElement {
  switch (detail.kind) {
    case "artifact": return (
      <div>
        <span className="mh-edge-tooltip-code">{detail.contractId}@{detail.contractRevision}</span>
        <p>Necesario para {requiredForLabel(detail.requiredFor)}.</p>
      </div>
    );
    case "contract": return (
      <div>
        <span className="mh-edge-tooltip-code">{detail.contractId}@{detail.contractRevision}</span>
        <p>Revisiones productor {detail.producerRevision} · consumidor {detail.consumerRevision}.</p>
      </div>
    );
    case "conflict": return (
      <div>
        <p>{detail.reason}</p>
        <span className="mh-edge-tooltip-risk">Riesgo {riskLabel(detail.risk)}</span>
      </div>
    );
  }
}

function relationLanePath(sourceX: number, sourceY: number, targetX: number, targetY: number, laneY: number): string {
  const direction = targetX >= sourceX ? 1 : -1;
  const radius = Math.min(8, Math.abs(targetX - sourceX) / 2, (laneY - sourceY) / 2, (laneY - targetY) / 2);
  return [
    `M ${sourceX} ${sourceY}`,
    `L ${sourceX} ${laneY - radius}`,
    `Q ${sourceX} ${laneY} ${sourceX + direction * radius} ${laneY}`,
    `L ${targetX - direction * radius} ${laneY}`,
    `Q ${targetX} ${laneY} ${targetX} ${laneY - radius}`,
    `L ${targetX} ${targetY}`
  ].join(" ");
}

function relationAriaLabel(relation: GraphRelationView, nodes: readonly RunNodeView[]): string {
  const labels: Record<GraphRelationKind, string> = {
    hierarchy: "jerarquía",
    artifact: "artefacto",
    contract: "contrato",
    conflict: "conflicto"
  };
  return `${nodeTitle(nodes, relation.source)} a ${nodeTitle(nodes, relation.target)}: ${labels[relation.kind]}`;
}

function nodeTitle(nodes: readonly RunNodeView[], nodeId: string): string {
  return nodes.find((node) => node.id === nodeId)?.title ?? nodeId;
}

function relationKindLabel(kind: GraphRelationKind): string {
  const labels: Record<GraphRelationKind, string> = {
    hierarchy: "Jerarquía",
    artifact: "Artefacto requerido",
    contract: "Contrato de integración",
    conflict: "Conflicto"
  };
  return labels[kind];
}

function requiredForLabel(requiredFor: Extract<GraphRelationDetail, { kind: "artifact" }>["requiredFor"]): string {
  const labels = { execution: "ejecución", validation: "validación", integration: "integración" } as const;
  return labels[requiredFor];
}

function riskLabel(risk: Extract<GraphRelationDetail, { kind: "conflict" }>["risk"]): string {
  const labels = { low: "bajo", medium: "medio", high: "alto" } as const;
  return labels[risk];
}

function relationCountsFor(model: RunModel): Record<Exclude<GraphLens, "execution">, number> {
  if (model.graph === null) return { artifact: 0, contract: 0, conflict: 0, all: 0 };
  const artifact = model.graph.artifactRequirements.length;
  const contract = model.graph.seamBindings.length;
  const conflict = model.graph.conflictConstraints.length;
  return { artifact, contract, conflict, all: artifact + contract + conflict };
}

function statusColor(status: NodeExecutionStatus): string {
  switch (status) {
    case "ready": return "var(--status-ready-fg)";
    case "running": return "var(--status-running-fg)";
    case "waiting": return "var(--status-review-fg)";
    case "succeeded": return "var(--status-completed-fg)";
    case "failed": return "var(--status-failed-fg)";
    case "stale": return "var(--color-text-subtle)";
    default: return "var(--color-border-strong)";
  }
}

function statusLabel(status: NodeExecutionStatus): string {
  const labels: Record<NodeExecutionStatus, string> = {
    pending: "pendiente",
    ready: "listo",
    running: "ejecutando",
    waiting: "decisión",
    succeeded: "completo",
    failed: "falló",
    stale: "obsoleto"
  };
  return labels[status];
}
