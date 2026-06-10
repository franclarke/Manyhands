/**
 * Workspace surface view-model (PR 08 → PR 09) — the phase-adaptive projection of
 * the work surface, with a compact per-node VITAL SIGN of the agent's work.
 *
 * It turns the operative model into a surface that MATURES with the run (proposal →
 * foundation → supervision → reconciliation → disposition) and, for each node,
 * exposes a `vital` summary (running / verifying / repairing / done / obsolete /
 * blocked / failed + build·tests·retry, reasons, conflict/amendment summaries).
 *
 * Pure and node-testable. Visual STATE (`display`) always comes from
 * `selectRenderableNodeState` (through the proto rows) and freshness/invalidation
 * from the selectors — NEVER from `execution.kind`. Execution is read ONLY in this
 * model layer for ancillary LABELS (agent/model, commit, cause, waitingOn); it is
 * never used to decide what to paint. Nothing here mutates or persists state.
 */
import {
  selectProtoView,
  type ProtoConflictRow,
  type ProtoDebug,
  type ProtoFrame,
  type ProtoViewOptions
} from "./proto-view";
import { formatDecisionKind } from "./decision-channel-view";
import { selectGranularityMetrics, selectIntegrationProgress } from "./selectors";
import type {
  AmendmentChangeKind,
  BuildStatus,
  CompositeIntegration,
  Freshness,
  GranularityMetrics,
  InvalidationTraceEntry,
  Node,
  NodeDisplay,
  NodeId,
  NodeRole,
  RunHealth,
  RunModel,
  RunPhase,
  SeamId,
  SeamState,
  TestSummary,
  VerifyLoop
} from "./types";

// ── Shapes ──────────────────────────────────────────────────────────────────────

/** The surface mode IS the run phase (frozen vocabulary; no second naming). */
export type WorkspaceSurfaceMode = RunPhase;

/** Compact vital-sign status — a refinement of `display` (e.g. verifying→repairing). */
export type VitalStatus =
  | "idle"
  | "planning"
  | "running"
  | "verifying"
  | "repairing"
  | "done"
  | "obsolete"
  | "blocked"
  | "failed";

export interface NodeVital {
  status: VitalStatus;
  label: string;
  /** Secondary line: agent·model / commit / cause / reason / verification summary. */
  detail?: string;
  buildStatus?: BuildStatus;
  testProgress?: { pass: number; total: number };
  retryLabel?: string;
  /** True when the node is re-iterating after a failed check (autonomous repair). */
  repairActive: boolean;
  verificationSummary?: string;
  obsoleteReason?: string;
  blockedReason?: string;
  conflictSummary?: string;
  amendmentSummary?: string;
}

export interface WorkspaceNode {
  id: NodeId;
  title: string;
  role: NodeRole;
  depth: number;
  parentId: NodeId | null;
  /** Paint state — from `selectRenderableNodeState`, never `execution.kind`. */
  display: NodeDisplay;
  freshness: Freshness;
  isInWavefront: boolean;
  isBlocked: boolean;
  isInvalidated: boolean;
  isPendingReexecution: boolean;
  /** In a PROPOSED amendment's blast radius and not yet realized (preview). */
  isAffectedByPendingAmendment: boolean;
  hasActiveConflict: boolean;
  produces: SeamId[];
  consumes: SeamId[];
  vital: NodeVital;
  verify?: VerifyLoop;
}

export interface WorkspaceColumn {
  depth: number;
  nodes: WorkspaceNode[];
}

export interface WorkspaceEdge {
  id: string;
  source: NodeId;
  target: NodeId;
  kind: "hierarchy" | "dependency";
  seamId?: SeamId;
}

export interface WorkspaceSeam {
  id: SeamId;
  producerNodeId: NodeId;
  consumerNodeIds: NodeId[];
  state: SeamState;
  revision: number;
  signatureSummary: string;
  contractSummary?: string;
  lastChangeKind?: AmendmentChangeKind;
  affectedNodeIds: NodeId[];
}

export interface WorkspaceWave {
  id: string;
  index: number;
  nodeIds: NodeId[];
  opened: boolean;
  closed: boolean;
}

export interface WorkspaceEvidence {
  tests: TestSummary;
  aggregateDiffRef: string;
  narrativeRef: string;
  integrationCommit: string;
  invalidationTrace?: InvalidationTraceEntry[];
}

export interface WorkspaceBlastPreview {
  active: boolean;
  nodeIds: NodeId[];
}

export interface WorkspaceEmphasis {
  showApprovePlanCallout: boolean;
  showSeamsFrozen: boolean;
  showWaves: boolean;
  showWavefront: boolean;
  showConflicts: boolean;
  showIntegrationProgress: boolean;
  showBlastPreview: boolean;
  showEvidenceProtagonist: boolean;
  showMetrics: boolean;
}

export interface WorkspaceView {
  mode: WorkspaceSurfaceMode;
  phase: RunPhase;
  health: RunHealth;
  intent: string;
  frame: ProtoFrame;
  debug: ProtoDebug;
  nodes: WorkspaceNode[];
  columns: WorkspaceColumn[];
  edges: WorkspaceEdge[];
  seams: WorkspaceSeam[];
  waves: WorkspaceWave[];
  conflicts: ProtoConflictRow[];
  wavefront: NodeId[];
  blocked: NodeId[];
  invalidatedNodes: NodeId[];
  affectedByPendingAmendment: NodeId[];
  pendingReexecution: NodeId[];
  blastPreview: WorkspaceBlastPreview;
  evidence: WorkspaceEvidence | null;
  /** Per-composite reconciliation progress (Reconciliation depth). */
  integration: CompositeIntegration[];
  /** Granularity metrics once `run.metrics.ready` arrives (Disposition / thesis). */
  metrics: GranularityMetrics | null;
  emphasis: WorkspaceEmphasis;
}

// ── Vital-sign helpers (pure) ─────────────────────────────────────────────────

function vitalStatusOf(display: NodeDisplay, isBlocked: boolean, repairActive: boolean): VitalStatus {
  switch (display) {
    case "failed":
      return "failed";
    case "obsolete":
      return "obsolete";
    case "running":
      return "running";
    case "verifying":
      return repairActive ? "repairing" : "verifying";
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    case "idle":
    default:
      return isBlocked ? "blocked" : "idle";
  }
}

function vitalLabelOf(status: VitalStatus, role: NodeRole): string {
  switch (status) {
    case "planning":
      return "Generando";
    case "running":
      return "Ejecutando";
    case "verifying":
      return "Verificando";
    case "repairing":
      return "Reparando automáticamente";
    case "done":
      return role === "leaf" ? "Verificado" : "Integrado";
    case "obsolete":
      return "Obsoleto";
    case "blocked":
      return "Bloqueado";
    case "failed":
      return "Falló";
    case "idle":
    default:
      return "En espera";
  }
}

function planningVitalOf(entity: Node | undefined): NodeVital | null {
  const planning = entity?.planning;
  if (planning === undefined) return null;

  let label: string;
  let detail: string | undefined;
  switch (planning.state) {
    case "generating":
      label = "Generando";
      detail = planning.maxAttempts !== undefined ? `intento 1/${planning.maxAttempts}` : undefined;
      break;
    case "retrying":
      label = "Reintentando planning";
      detail =
        planning.attempt !== undefined && planning.maxAttempts !== undefined
          ? `intento ${planning.attempt}/${planning.maxAttempts}`
          : planning.errorKind;
      break;
    case "generated":
      label = "Planificado";
      detail = planning.durationMs !== undefined ? `${planning.durationMs} ms` : undefined;
      break;
    case "fallback":
      label = "Generado con fallback";
      detail = planning.errorKind;
      break;
    case "failed":
      label = "Fallo al planificar";
      detail = planning.errorMessage ?? planning.errorKind;
      break;
    default:
      return null;
  }

  return {
    status: "planning",
    label,
    repairActive: false,
    ...(detail !== undefined ? { detail } : {})
  };
}

function buildVerificationSummary(verify: VerifyLoop): string {
  const build = verify.build === "pass" ? "✓" : verify.build === "fail" ? "✗" : "…";
  return `Build ${build} · Tests ${verify.testsPass}/${verify.testsTotal} · Retry ${verify.iteration}/${verify.maxIterations}`;
}

/** Ancillary execution detail for LABELS only — never used to decide display. */
function executionAncillary(node: Node): { agent?: string; model?: string; commit?: string; cause?: string; waitingOn?: string[] } {
  const e = node.execution;
  switch (e.kind) {
    case "running":
      return { agent: e.agent, model: e.model };
    case "integrated":
      return { commit: e.commit };
    case "failed":
      return { cause: e.cause };
    case "blocked":
      return { waitingOn: e.waitingOn.map((w) => String(w)) };
    default:
      return {};
  }
}

function obsoleteReasonOf(entity: Node | undefined, model: RunModel): string {
  if (entity !== undefined) {
    for (const seamId of entity.consumes) {
      const seam = model.seams.get(seamId);
      if (seam !== undefined && seam.lastChangeKind === "signature") return `cambio de firma en ${seam.id}`;
    }
  }
  return "una costura cambió aguas arriba";
}

function blockedReasonOf(id: NodeId, model: RunModel, waitingOn: string[] | undefined): string {
  for (const d of model.decisions.values()) {
    if (d.status === "pending" && d.blocking && (d.context.nodeIds ?? []).includes(id)) {
      return `esperando decisión: ${formatDecisionKind(d.kind)}`;
    }
  }
  if (waitingOn !== undefined && waitingOn.length > 0) return `esperando: ${waitingOn.join(", ")}`;
  return "bloqueado";
}

// ── Projection ──────────────────────────────────────────────────────────────────

export function selectWorkspaceView(model: RunModel, options: ProtoViewOptions = {}): WorkspaceView {
  const proto = selectProtoView(model, options);
  const mode = proto.frame.phase;

  const invalidatedSet = new Set(proto.debug.invalidatedNodes);
  const pendingReexSet = new Set(proto.debug.pendingReexecution);
  const conflictNodeIds = new Set<NodeId>();
  for (const c of proto.conflicts) for (const n of c.nodeIds) conflictNodeIds.add(n);

  // Blast radius of PENDING (proposed) amendments — distinct from realized invalidation.
  const pendingAmendmentAffected = new Set<NodeId>();
  for (const a of model.amendments.values()) {
    if (a.status !== "proposed") continue;
    for (const n of a.affects) pendingAmendmentAffected.add(n);
  }

  const nodes: WorkspaceNode[] = proto.nodes.map((row) => {
    const entity = model.nodes.get(row.id);
    const freshness: Freshness = invalidatedSet.has(row.id) ? "stale" : "fresh";
    const isInvalidated = invalidatedSet.has(row.id);
    const isBlocked = row.blocked;
    const isAffectedByPendingAmendment = pendingAmendmentAffected.has(row.id) && !isInvalidated;

    const verify = row.verify;
    const repairActive =
      row.display === "verifying" &&
      verify !== undefined &&
      (verify.build === "fail" || verify.testsPass < verify.testsTotal);
    const planningVital = row.display === "idle" ? planningVitalOf(entity) : null;
    const status = vitalStatusOf(row.display, isBlocked, repairActive);
    const anc = entity !== undefined ? executionAncillary(entity) : {};
    const verificationSummary = verify !== undefined ? buildVerificationSummary(verify) : undefined;

    const conflictDims = [...new Set(proto.conflicts.filter((c) => c.nodeIds.includes(row.id)).map((c) => c.dimension))];
    const conflictSummary = conflictDims.length > 0 ? conflictDims.join(", ") : undefined;

    let pendingChangeKind: AmendmentChangeKind | undefined;
    if (isAffectedByPendingAmendment) {
      for (const a of model.amendments.values()) {
        if (a.status === "proposed" && a.affects.includes(row.id)) {
          pendingChangeKind = a.changeKind;
          break;
        }
      }
    }
    const amendmentSummary = pendingChangeKind !== undefined ? `afectado si se aprueba · ${pendingChangeKind}` : undefined;

    let detail: string | undefined;
    let obsoleteReason: string | undefined;
    let blockedReason: string | undefined;
    switch (status) {
      case "running":
        detail = anc.agent !== undefined ? `${anc.agent}${anc.model !== undefined ? ` · ${anc.model}` : ""}` : undefined;
        break;
      case "verifying":
      case "repairing":
        detail = verificationSummary;
        break;
      case "done":
        detail = anc.commit !== undefined ? `commit ${anc.commit}` : undefined;
        break;
      case "failed":
        detail = anc.cause;
        break;
      case "obsolete":
        obsoleteReason = obsoleteReasonOf(entity, model);
        detail = obsoleteReason;
        break;
      case "blocked":
        blockedReason = blockedReasonOf(row.id, model, anc.waitingOn);
        detail = blockedReason;
        break;
      default:
        break;
    }

    const vital: NodeVital = planningVital ?? {
      status,
      label: vitalLabelOf(status, row.role),
      repairActive,
      ...(detail !== undefined ? { detail } : {}),
      ...(verify !== undefined
        ? {
            buildStatus: verify.build,
            testProgress: { pass: verify.testsPass, total: verify.testsTotal },
            retryLabel: `${verify.iteration}/${verify.maxIterations}`,
            verificationSummary: buildVerificationSummary(verify)
          }
        : {}),
      ...(obsoleteReason !== undefined ? { obsoleteReason } : {}),
      ...(blockedReason !== undefined ? { blockedReason } : {}),
      ...(conflictSummary !== undefined ? { conflictSummary } : {}),
      ...(amendmentSummary !== undefined ? { amendmentSummary } : {})
    };

    return {
      id: row.id,
      title: row.title,
      role: row.role,
      depth: row.depth,
      parentId: row.parentId,
      display: row.display,
      freshness,
      isInWavefront: row.onWavefront,
      isBlocked,
      isInvalidated,
      isPendingReexecution: pendingReexSet.has(row.id),
      isAffectedByPendingAmendment,
      hasActiveConflict: conflictNodeIds.has(row.id),
      produces: entity !== undefined ? [...entity.produces] : [],
      consumes: entity !== undefined ? [...entity.consumes] : [],
      vital,
      ...(verify !== undefined ? { verify } : {})
    };
  });

  // Columns by depth ascending, preserving model insertion order within a depth.
  const byDepth = new Map<number, WorkspaceNode[]>();
  for (const n of nodes) {
    const bucket = byDepth.get(n.depth) ?? [];
    bucket.push(n);
    byDepth.set(n.depth, bucket);
  }
  const columns: WorkspaceColumn[] = [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, ns]) => ({ depth, nodes: ns }));

  // Edges: hierarchy (parent→child) + dependency (producer→consumer via seam).
  const edges: WorkspaceEdge[] = [];
  for (const n of nodes) {
    if (n.parentId !== null) {
      edges.push({ id: `h:${n.parentId}:${n.id}`, source: n.parentId, target: n.id, kind: "hierarchy" });
    }
  }
  for (const seam of model.seams.values()) {
    for (const consumer of seam.consumerNodeIds) {
      edges.push({
        id: `d:${seam.id}:${seam.producerNodeId}:${consumer}`,
        source: seam.producerNodeId,
        target: consumer,
        kind: "dependency",
        seamId: seam.id
      });
    }
  }

  // Amendment blast radius per seam (projection) for the seam view.
  const affectedBySeam = new Map<SeamId, Set<NodeId>>();
  for (const a of model.amendments.values()) {
    const sid = a.detail.seamId;
    if (sid === undefined) continue;
    const set = affectedBySeam.get(sid) ?? new Set<NodeId>();
    for (const nodeId of a.affects) set.add(nodeId);
    affectedBySeam.set(sid, set);
  }

  const seams: WorkspaceSeam[] = [...model.seams.values()].map((seam) => ({
    id: seam.id,
    producerNodeId: seam.producerNodeId,
    consumerNodeIds: [...seam.consumerNodeIds],
    state: seam.state,
    revision: seam.revision,
    signatureSummary: seam.signature.frozen ?? seam.signature.draft,
    ...(seam.contract !== undefined ? { contractSummary: formatContract(seam.contract) } : {}),
    ...(seam.lastChangeKind !== undefined ? { lastChangeKind: seam.lastChangeKind } : {}),
    affectedNodeIds: [...(affectedBySeam.get(seam.id) ?? [])]
  }));

  const waves: WorkspaceWave[] = [...model.waves.values()].map((w) => ({
    id: w.id,
    index: w.index,
    nodeIds: [...w.nodeIds],
    opened: w.opened === true,
    closed: w.closed === true
  }));

  const evidence: WorkspaceEvidence | null =
    model.evidence !== undefined
      ? {
          tests: model.evidence.tests,
          aggregateDiffRef: model.evidence.aggregateDiffRef,
          narrativeRef: model.evidence.narrativeRef,
          integrationCommit: model.evidence.integrationCommit,
          ...(model.evidence.invalidationTrace !== undefined
            ? { invalidationTrace: model.evidence.invalidationTrace }
            : {})
        }
      : null;

  const affectedByPendingAmendment = [...pendingAmendmentAffected];
  const blastPreview: WorkspaceBlastPreview = {
    active: affectedByPendingAmendment.length > 0 && proto.debug.invalidatedNodes.length === 0,
    nodeIds: affectedByPendingAmendment
  };

  const integration = selectIntegrationProgress(model);
  const metrics = selectGranularityMetrics(model);

  const hasPendingApprovePlan = proto.frame.attention.some((a) => a.kind === "approve_plan");
  const emphasis: WorkspaceEmphasis = {
    showApprovePlanCallout: mode === "proposal" && hasPendingApprovePlan,
    showSeamsFrozen: mode === "foundation",
    showWaves: (mode === "foundation" || mode === "supervision") && waves.length > 0,
    showWavefront: mode === "supervision",
    showConflicts: mode === "reconciliation" && proto.conflicts.length > 0,
    showIntegrationProgress: mode === "reconciliation" && integration.length > 0,
    showBlastPreview: blastPreview.active,
    showEvidenceProtagonist: mode === "disposition" && evidence !== null,
    showMetrics: mode === "disposition" && metrics !== null
  };

  return {
    mode,
    phase: mode,
    health: proto.frame.health,
    intent: proto.frame.intent,
    frame: proto.frame,
    debug: proto.debug,
    nodes,
    columns,
    edges,
    seams,
    waves,
    conflicts: proto.conflicts,
    wavefront: proto.debug.wavefront,
    blocked: proto.debug.blockedNodeIds,
    invalidatedNodes: proto.debug.invalidatedNodes,
    affectedByPendingAmendment,
    pendingReexecution: proto.debug.pendingReexecution,
    blastPreview,
    evidence,
    integration,
    metrics,
    emphasis
  };
}

function formatContract(contract: Record<string, string>): string {
  return Object.entries(contract)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
}
