/**
 * Proto view presenter — the PURE projection the fixture prototype renders.
 *
 * PR 06 of docs/design/implementation-plan.md. This is NOT the final UI; it is the
 * single composition point that turns a `RunModel` into everything the prototype
 * page paints, by composing the PR 05 selectors. It lives in the model layer (not
 * inside a component) so it stays pure and node-testable — the React shell in
 * `apps/web/src/components/run-model/*` is a thin render over this object.
 *
 * Discipline honoured (docs/design/run-operative-model.md, frozen):
 *  - Components never derive: ALL phase/health/wavefront/freshness/invalidation
 *    comes from selectors, composed here once. The component re-reads, it never
 *    re-derives.
 *  - A node's paint state is `selectRenderableNodeState(...).display` ONLY; this
 *    presenter never reads `node.execution.kind`. `integrated + stale` → "obsolete".
 *  - Empty attention is success ("nada requiere tu atención"), never a void.
 *  - No persisted derived state: this is recomputed from the model on every call;
 *    nothing here is stored back on the model (no parallel `nodeStatusOverrides`).
 *
 * Static node/seam facts (title, role, depth, parentId, seam name/producer) are
 * read straight from the entities — those are identity, not visual STATE; the
 * visual state of a node is taken exclusively from the renderable selector.
 */
import {
  selectAffectedByAmendment,
  selectAttention,
  selectBlocked,
  selectConflicts,
  selectEvidence,
  selectHealth,
  selectInvalidatedNodes,
  selectPendingReexecution,
  selectPhase,
  selectRenderableNodeState,
  selectWavefront
} from "./selectors";
import type {
  AmendmentChangeKind,
  ConflictDimension,
  ConflictId,
  ConflictStatus,
  DecisionId,
  DecisionKind,
  NodeDisplay,
  NodeId,
  NodeRole,
  RunHealth,
  RunModel,
  RunPhase,
  SeamId,
  SeamState,
  VerifyLoop
} from "./types";

// ── View shapes ─────────────────────────────────────────────────────────────────

export interface ProtoAttentionItem {
  id: DecisionId;
  kind: DecisionKind;
  blocking: boolean;
  question?: string;
  nodeIds: NodeId[];
}

export interface ProtoFrame {
  intent: string;
  phase: RunPhase;
  health: RunHealth;
  nodeCount: number;
  pendingDecisionCount: number;
  activeConflictCount: number;
  wavefrontCount: number;
  hasEvidence: boolean;
  /** True when nothing needs the human — rendered as success, never as a void. */
  attentionClear: boolean;
  /** Success-first summary copy for the attention area. */
  attentionSummary: string;
  attention: ProtoAttentionItem[];
}

export interface ProtoNodeRow {
  id: NodeId;
  title: string;
  role: NodeRole;
  depth: number;
  parentId: NodeId | null;
  /** The ONLY field the card paints state from. Never `execution.kind`. */
  display: NodeDisplay;
  onWavefront: boolean;
  blocked: boolean;
  obsolete: boolean;
  failed: boolean;
  done: boolean;
  /** In the as-proposed blast radius of some amendment (projected, not invalidation). */
  affectedByAmendment: boolean;
  /** Compact verify vital sign while verifying (PR 09 refines the display). */
  verify?: VerifyLoop;
}

export interface ProtoColumn {
  depth: number;
  nodes: ProtoNodeRow[];
}

export interface ProtoSeamEdge {
  id: SeamId;
  name: string;
  producerNodeId: NodeId;
  consumerNodeIds: NodeId[];
  state: SeamState;
  revision: number;
  lastChangeKind?: AmendmentChangeKind;
}

export interface ProtoConflictRow {
  id: ConflictId;
  dimension: ConflictDimension;
  status: ConflictStatus;
  nodeIds: NodeId[];
  autoResolvable: boolean;
}

export interface ProtoDebug {
  fixtureName?: string;
  cursor: number;
  lastEventType?: string;
  lastEventSeq?: number;
  phase: RunPhase;
  health: RunHealth;
  wavefront: NodeId[];
  pendingDecisionIds: DecisionId[];
  blockedNodeIds: NodeId[];
  activeConflictCount: number;
  invalidatedNodes: NodeId[];
  pendingReexecution: NodeId[];
}

export interface ProtoView {
  frame: ProtoFrame;
  nodes: ProtoNodeRow[];
  columns: ProtoColumn[];
  seams: ProtoSeamEdge[];
  conflicts: ProtoConflictRow[];
  debug: ProtoDebug;
}

export interface ProtoViewOptions {
  fixtureName?: string;
  lastEvent?: { type: string; seq: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Union of every amendment's as-proposed blast snapshot (projection, audit). */
function amendmentAffectedSet(model: RunModel): Set<NodeId> {
  const affected = new Set<NodeId>();
  for (const id of model.amendments.keys()) {
    for (const nodeId of selectAffectedByAmendment(model, id)) affected.add(nodeId);
  }
  return affected;
}

/** Single source of the success-first attention copy. Reused by the decision channel. */
export function formatAttentionSummary(clear: boolean, wavefrontCount: number, blocking: number, total: number): string {
  if (clear) {
    return wavefrontCount > 0
      ? `${wavefrontCount} ${wavefrontCount === 1 ? "agente trabajando" : "agentes trabajando"} · nada requiere tu atención`
      : "Nada requiere tu atención";
  }
  if (blocking > 0) {
    return blocking === 1
      ? "1 decisión bloqueante requiere tu atención"
      : `${blocking} decisiones bloqueantes requieren tu atención`;
  }
  return total === 1 ? "1 aviso requiere tu atención" : `${total} avisos requieren tu atención`;
}

// ── The projection ──────────────────────────────────────────────────────────────

export function selectProtoView(model: RunModel, options: ProtoViewOptions = {}): ProtoView {
  const wavefront = selectWavefront(model);
  const wavefrontSet = new Set(wavefront);
  const blocked = selectBlocked(model);
  const blockedSet = new Set(blocked);
  const affectedSet = amendmentAffectedSet(model);
  const invalidated = selectInvalidatedNodes(model);
  const pendingReexecution = selectPendingReexecution(model);

  const nodes: ProtoNodeRow[] = [];
  for (const node of model.nodes.values()) {
    const rs = selectRenderableNodeState(model, node.id);
    const row: ProtoNodeRow = {
      id: node.id,
      title: node.title,
      role: node.role,
      depth: node.depth,
      parentId: node.parentId,
      display: rs.display,
      onWavefront: wavefrontSet.has(node.id),
      blocked: blockedSet.has(node.id),
      obsolete: rs.obsolete,
      failed: rs.display === "failed",
      done: rs.display === "done",
      affectedByAmendment: affectedSet.has(node.id),
      ...(rs.verify !== undefined ? { verify: rs.verify } : {})
    };
    nodes.push(row);
  }

  // Columns by depth (ascending), preserving model insertion order within a depth.
  const byDepth = new Map<number, ProtoNodeRow[]>();
  for (const row of nodes) {
    const bucket = byDepth.get(row.depth) ?? [];
    bucket.push(row);
    byDepth.set(row.depth, bucket);
  }
  const columns: ProtoColumn[] = [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, rows]) => ({ depth, nodes: rows }));

  const seams: ProtoSeamEdge[] = [...model.seams.values()].map((seam) => ({
    id: seam.id,
    name: seam.name,
    producerNodeId: seam.producerNodeId,
    consumerNodeIds: [...seam.consumerNodeIds],
    state: seam.state,
    revision: seam.revision,
    ...(seam.lastChangeKind !== undefined ? { lastChangeKind: seam.lastChangeKind } : {})
  }));

  const conflicts: ProtoConflictRow[] = selectConflicts(model).map((c) => ({
    id: c.id,
    dimension: c.dimension,
    status: c.status,
    nodeIds: [...c.nodeIds],
    autoResolvable: c.autoResolvable
  }));

  const attention: ProtoAttentionItem[] = selectAttention(model).map((d) => ({
    id: d.id,
    kind: d.kind,
    blocking: d.blocking,
    ...(d.context.question !== undefined ? { question: d.context.question } : {}),
    nodeIds: [...(d.context.nodeIds ?? [])]
  }));

  const blockingCount = attention.filter((a) => a.blocking).length;
  const attentionClear = attention.length === 0;

  const frame: ProtoFrame = {
    intent: model.run.intent,
    phase: selectPhase(model),
    health: selectHealth(model),
    nodeCount: model.nodes.size,
    pendingDecisionCount: attention.length,
    activeConflictCount: conflicts.length,
    wavefrontCount: wavefront.length,
    hasEvidence: selectEvidence(model) !== null,
    attentionClear,
    attentionSummary: formatAttentionSummary(attentionClear, wavefront.length, blockingCount, attention.length),
    attention
  };

  const debug: ProtoDebug = {
    ...(options.fixtureName !== undefined ? { fixtureName: options.fixtureName } : {}),
    cursor: model.cursor,
    ...(options.lastEvent !== undefined
      ? { lastEventType: options.lastEvent.type, lastEventSeq: options.lastEvent.seq }
      : {}),
    phase: frame.phase,
    health: frame.health,
    wavefront,
    pendingDecisionIds: attention.map((a) => a.id),
    blockedNodeIds: blocked,
    activeConflictCount: conflicts.length,
    invalidatedNodes: invalidated,
    pendingReexecution
  };

  return { frame, nodes, columns, seams, conflicts, debug };
}
