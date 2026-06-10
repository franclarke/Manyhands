/**
 * Focus view-model (PR-U1) — the polymorphic "deep on-demand" projection.
 *
 * Source of truth: docs/design/run-operative-model.md + implementation-status.md §8
 * (PR-U1 reframing of PR10). Given a `RunModel` + a `FocusTarget` it builds a pure,
 * discriminated `FocusView` for node / seam / conflict / decision / evidence. It is
 * the model layer for the focus panel: the React component (`focus-panel.tsx`) is a
 * thin render over THIS object — it never reads the raw `RunModel`.
 *
 * Discipline honoured (frozen):
 *  - PURE and node-testable: never mutates the model, never touches React/SSE.
 *  - It DERIVES, it does not duplicate: a node's paint `display`/`freshness`/vital
 *    come from `selectWorkspaceView` (→ `selectRenderableNodeState`), never from
 *    `execution.kind`. A stale `integrated` node focuses as `obsolete`, never `done`.
 *  - Heavy artifacts (diff/log/diagnosis/narrative) are surfaced as `*Ref`
 *    descriptors only — never embedded. Per-node diff/log have no real ref in the
 *    v1 fixtures, so they are generated placeholders flagged `available:false`.
 *  - A target that does not exist in the current cut returns a safe `missing`
 *    view (never throws), so deep-links resolve before the entity appears.
 */
import {
  selectWorkspaceView,
  type NodeVital,
  type WorkspaceEvidence,
  type WorkspaceNode,
  type WorkspaceSeam
} from "./workspace-view";
import { formatDecisionKind } from "./decision-channel-view";
import type {
  AmendmentChangeKind,
  AmendmentId,
  Conflict,
  ConflictDimension,
  ConflictId,
  ConflictStatus,
  Decision,
  DecisionChoice,
  DecisionContext,
  DecisionId,
  DecisionKind,
  DecisionStatus,
  Freshness,
  GranularityMetrics,
  InvalidationTraceEntry,
  IsoTimestamp,
  NodeDisplay,
  NodeId,
  NodePlanningStatus,
  NodeRole,
  RunEvent,
  RunModel,
  SeamId,
  SeamRevisionRef,
  SeamState,
  TestSummary
} from "./types";

// ── FocusTarget (the addressable handle, also the deep-link payload) ─────────────

export const FOCUS_KINDS = ["node", "seam", "conflict", "decision", "evidence"] as const;
export type FocusKind = (typeof FOCUS_KINDS)[number];

/** What the human asked to inspect. Serialized as `<kind>:<id>` for deep-links. */
export interface FocusTarget {
  kind: FocusKind;
  id: string;
}

/** There is one run-level evidence; this is its conventional addressable handle. */
export const EVIDENCE_FOCUS_TARGET: FocusTarget = { kind: "evidence", id: "final" };

export function isFocusKind(value: string): value is FocusKind {
  return (FOCUS_KINDS as readonly string[]).includes(value);
}

/** `node:n-api` → `{ kind: "node", id: "n-api" }`. Returns null for anything malformed. */
export function parseFocusTarget(raw: string | null | undefined): FocusTarget | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  const sep = trimmed.indexOf(":");
  if (sep <= 0) return null;
  const kind = trimmed.slice(0, sep);
  const id = trimmed.slice(sep + 1).trim();
  if (!isFocusKind(kind) || id.length === 0) return null;
  return { kind, id };
}

/** `{ kind: "node", id: "n-api" }` → `node:n-api`. Inverse of `parseFocusTarget`. */
export function formatFocusTarget(target: FocusTarget): string {
  return `${target.kind}:${target.id}`;
}

// ── Shared descriptors ──────────────────────────────────────────────────────────

/**
 * A reference to a heavy artifact resolved on demand. `available:false` means it is
 * a generated placeholder (the v1 fixtures carry no real ref) — the panel shows it
 * as "Artefacto referenciado: <ref>" without a real viewer.
 */
export interface FocusRef {
  label: string;
  ref: string;
  available: boolean;
}

export interface FocusSeamSummary {
  id: SeamId;
  name: string;
  state: SeamState;
  revision: number;
}

export interface FocusNodeSummary {
  id: NodeId;
  title: string;
}

export interface NodeConsoleLine {
  seq: number;
  at: IsoTimestamp;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface NodeConsoleView {
  lines: NodeConsoleLine[];
  truncated: boolean;
}

// ── FocusView (discriminated union) ──────────────────────────────────────────────

export interface NodeFocusView {
  kind: "node";
  id: NodeId;
  title: string;
  role: NodeRole;
  depth: number;
  goal: string;
  parentId: NodeId | null;
  parent?: FocusNodeSummary;
  scope: { paths: string[]; origin: "guessed" | "derived" };
  display: NodeDisplay;
  freshness: Freshness;
  vital: NodeVital;
  produces: FocusSeamSummary[];
  consumes: FocusSeamSummary[];
  builtAgainst: SeamRevisionRef[];
  producedRevision?: SeamRevisionRef;
  changedFiles: string[];
  /** Graph-generation telemetry (retry/fallback/failed) — orthogonal to `display`. */
  planning?: NodePlanningStatus;
  commit?: string;
  isInWavefront: boolean;
  isBlocked: boolean;
  isInvalidated: boolean;
  isPendingReexecution: boolean;
  isAffectedByPendingAmendment: boolean;
  hasActiveConflict: boolean;
  /** Visible Gemini/process output for this node, derived from raw `node.cli.output` events. */
  console: NodeConsoleView;
  refs: FocusRef[];
}

export interface SeamFocusView {
  kind: "seam";
  id: SeamId;
  name: string;
  state: SeamState;
  revision: number;
  producerNodeId: NodeId;
  producer?: FocusNodeSummary;
  consumerNodeIds: NodeId[];
  consumers: FocusNodeSummary[];
  signatureDraft: string;
  signatureFrozen?: string;
  contract?: Record<string, string>;
  lastChangeKind?: AmendmentChangeKind;
  affectedNodeIds: NodeId[];
  /** Short copy: why a frozen seam is what fabricates safe parallelism. */
  parallelismNote: string;
}

export interface ConflictDecisionRef {
  id: DecisionId;
  kind: DecisionKind;
  status: DecisionStatus;
}

export interface ConflictFocusView {
  kind: "conflict";
  id: ConflictId;
  dimension: ConflictDimension;
  status: ConflictStatus;
  nodeIds: NodeId[];
  seamId?: SeamId;
  files: string[];
  autoResolvable: boolean;
  diagnosisRef: FocusRef;
  resolution?: { by: "system" | "human"; resolutionId: string };
  decision?: ConflictDecisionRef;
  /** Copy: a behavioral conflict (or any non-auto-resolvable one) needs human judgement. */
  judgementNote: string;
}

export interface DecisionFocusConflictRef {
  id: ConflictId;
  dimension: ConflictDimension;
  status: ConflictStatus;
  diagnosisRef: string;
}

export interface DecisionFocusAmendmentRef {
  id: AmendmentId;
  changeKind: AmendmentChangeKind;
  affects: NodeId[];
  seamId?: SeamId;
}

export interface DecisionFocusSeamRef {
  id: SeamId;
  name: string;
  revision: number;
  state: SeamState;
}

export interface DecisionFocusEvidenceRef {
  tests: TestSummary;
  aggregateDiffRef: string;
  narrativeRef: string;
  integrationCommit: string;
}

export interface DecisionFocusView {
  kind: "decision";
  id: DecisionId;
  decisionKind: DecisionKind;
  label: string;
  blocking: boolean;
  status: DecisionStatus;
  summary: string;
  context: DecisionContext;
  question?: string;
  options?: string[];
  choice?: DecisionChoice;
  resolvedAt?: IsoTimestamp;
  nodeIds: NodeId[];
  affectedNodeIds: NodeId[];
  conflict?: DecisionFocusConflictRef;
  amendment?: DecisionFocusAmendmentRef;
  seam?: DecisionFocusSeamRef;
  evidence?: DecisionFocusEvidenceRef;
  /** Present only while pending: the action the channel would offer. */
  pendingAction?: { label: string };
}

export interface EvidenceFocusView {
  kind: "evidence";
  tests: TestSummary;
  aggregateDiffRef: FocusRef;
  narrativeRef: FocusRef;
  integrationCommit: string;
  invalidationTrace?: InvalidationTraceEntry[];
  reExecuted: NodeId[];
  reIntegrated: NodeId[];
  preserved: NodeId[];
  approveMergeDecision?: { id: DecisionId; status: DecisionStatus };
  /** Granularity metrics once available (Disposition / thesis instrument). */
  metrics?: GranularityMetrics;
  /** Copy of the final acceptance moment (fixture-first; no real merge). */
  acceptanceCopy: string;
}

export interface MissingFocusView {
  kind: "missing";
  target: FocusTarget;
  title: string;
  message: string;
}

export type FocusView =
  | NodeFocusView
  | SeamFocusView
  | ConflictFocusView
  | DecisionFocusView
  | EvidenceFocusView
  | MissingFocusView;

// ── Copy helpers ─────────────────────────────────────────────────────────────────

const DECISION_SUMMARY: Record<DecisionKind, string> = {
  approve_plan: "Aprobá el plan para comenzar la ejecución.",
  clarify: "El planner necesita una aclaración para continuar.",
  resolve_conflict: "Un conflicto necesita tu juicio para integrarse.",
  approve_amendment: "Una enmienda al plan espera tu aprobación.",
  approve_merge: "Revisá el resultado y aceptá el merge."
};

const DECISION_PRIMARY_ACTION: Record<DecisionKind, string> = {
  approve_plan: "Aprobar plan",
  clarify: "Responder",
  resolve_conflict: "Aplicar resolución fixtureada",
  approve_amendment: "Aprobar enmienda",
  approve_merge: "Aceptar resultado"
};

function conflictJudgementNote(dimension: ConflictDimension, autoResolvable: boolean): string {
  if (dimension === "behavioral") {
    return "Conflicto conductual: no se resuelve por sintaxis. Dos interpretaciones válidas chocan (p. ej. unidades distintas a través de una costura) y requiere tu juicio.";
  }
  if (!autoResolvable) {
    return "Este conflicto no es auto-resolvible: requiere tu juicio antes de integrar.";
  }
  return "Conflicto auto-resolvible: el sistema puede reconciliarlo sin intervención humana.";
}

function seamParallelismNote(seam: WorkspaceSeam, producerTitle: string | undefined): string {
  const producer = producerTitle ?? seam.producerNodeId;
  const consumers = seam.consumerNodeIds.length;
  const frozen = seam.state === "frozen" || seam.state === "amended";
  const consumerCopy = consumers === 1 ? "1 consumidor" : `${consumers} consumidores`;
  if (frozen) {
    return `Costura fijada: ${producer} expone un contrato estable que ${consumerCopy} consumen. Al congelar la firma, los consumidores trabajan en paralelo contra el contrato en vez de esperar la implementación real.`;
  }
  return `Costura en borrador: cuando se congele, ${producer} fijará un contrato que ${consumerCopy} podrán consumir en paralelo sin esperar la implementación real.`;
}

// ── Builders ─────────────────────────────────────────────────────────────────────

export interface FocusBuildOptions {
  events?: readonly RunEvent[];
}

function buildNodeFocus(model: RunModel, ws: WorkspaceNode, id: NodeId, options: FocusBuildOptions = {}): NodeFocusView {
  const entity = model.nodes.get(id);
  const seamSummary = (seamId: SeamId): FocusSeamSummary => {
    const seam = model.seams.get(seamId);
    return seam !== undefined
      ? { id: seam.id, name: seam.name, state: seam.state, revision: seam.revision }
      : { id: seamId, name: seamId, state: "draft", revision: 0 };
  };

  const parentEntity = ws.parentId !== null ? model.nodes.get(ws.parentId) : undefined;
  const commit = entity?.execution.kind === "integrated" ? entity.execution.commit : undefined;
  const runId = model.run.id;

  // Per-node diff/log only resolve once execution recorded a leaf result. For a
  // node that hasn't executed (planning / idle / blocked) there is nothing to fetch,
  // so we omit the refs instead of surfacing a 404 "Artifact not found".
  const hasNodeArtifacts =
    commit !== undefined ||
    (entity?.changedFiles?.length ?? 0) > 0 ||
    ws.display === "failed" ||
    ws.display === "done" ||
    ws.display === "obsolete";
  const nodeRefs: FocusRef[] = hasNodeArtifacts
    ? [
        { label: "Diff del nodo", ref: `diff://runs/${runId}/node/${ws.id}`, available: true },
        { label: "Log del agente", ref: `log://runs/${runId}/node/${ws.id}`, available: true }
      ]
    : [];

  return {
    kind: "node",
    id: ws.id,
    title: ws.title,
    role: ws.role,
    depth: ws.depth,
    goal: entity?.goal ?? "",
    parentId: ws.parentId,
    ...(parentEntity !== undefined ? { parent: { id: parentEntity.id, title: parentEntity.title } } : {}),
    scope: entity !== undefined ? { paths: [...entity.scope.paths], origin: entity.scope.origin } : { paths: [], origin: "guessed" },
    display: ws.display,
    freshness: ws.freshness,
    vital: ws.vital,
    produces: ws.produces.map(seamSummary),
    consumes: ws.consumes.map(seamSummary),
    builtAgainst: entity?.builtAgainst !== undefined ? [...entity.builtAgainst] : [],
    ...(entity?.producedRevision !== undefined ? { producedRevision: entity.producedRevision } : {}),
    changedFiles: entity?.changedFiles !== undefined ? [...entity.changedFiles] : [],
    ...(entity?.planning !== undefined ? { planning: { ...entity.planning } } : {}),
    ...(commit !== undefined ? { commit } : {}),
    isInWavefront: ws.isInWavefront,
    isBlocked: ws.isBlocked,
    isInvalidated: ws.isInvalidated,
    isPendingReexecution: ws.isPendingReexecution,
    isAffectedByPendingAmendment: ws.isAffectedByPendingAmendment,
    hasActiveConflict: ws.hasActiveConflict,
    console: buildNodeConsole(options.events ?? [], id),
    refs: nodeRefs
  };
}

function buildNodeConsole(events: readonly RunEvent[], nodeId: NodeId): NodeConsoleView {
  const all = events
    .filter((event) => event.type === "node.cli.output" && event.payload.nodeId === nodeId)
    .map((event): NodeConsoleLine => {
      const stream = event.payload.stream === "stderr" ? "stderr" : "stdout";
      return {
        seq: event.seq,
        at: event.at,
        stream,
        chunk: typeof event.payload.chunk === "string" ? event.payload.chunk : String(event.payload.chunk ?? "")
      };
    });
  const maxLines = 200;
  return { lines: all.slice(-maxLines), truncated: all.length > maxLines };
}

function buildSeamFocus(model: RunModel, ws: WorkspaceSeam, id: SeamId): SeamFocusView {
  const entity = model.seams.get(id);
  const producer = model.nodes.get(ws.producerNodeId);
  const consumers: FocusNodeSummary[] = ws.consumerNodeIds.map((cid) => {
    const node = model.nodes.get(cid);
    return { id: cid, title: node?.title ?? cid };
  });

  return {
    kind: "seam",
    id: ws.id,
    name: entity?.name ?? ws.id,
    state: ws.state,
    revision: ws.revision,
    producerNodeId: ws.producerNodeId,
    ...(producer !== undefined ? { producer: { id: producer.id, title: producer.title } } : {}),
    consumerNodeIds: [...ws.consumerNodeIds],
    consumers,
    signatureDraft: entity?.signature.draft ?? ws.signatureSummary,
    ...(entity?.signature.frozen !== undefined ? { signatureFrozen: entity.signature.frozen } : {}),
    ...(entity?.contract !== undefined ? { contract: { ...entity.contract } } : {}),
    ...(ws.lastChangeKind !== undefined ? { lastChangeKind: ws.lastChangeKind } : {}),
    affectedNodeIds: [...ws.affectedNodeIds],
    parallelismNote: seamParallelismNote(ws, producer?.title)
  };
}

function buildConflictFocus(model: RunModel, conflict: Conflict): ConflictFocusView {
  const decision = [...model.decisions.values()].find((d) => d.context.conflictId === conflict.id);
  return {
    kind: "conflict",
    id: conflict.id,
    dimension: conflict.dimension,
    status: conflict.status,
    nodeIds: [...conflict.nodeIds],
    ...(conflict.seamId !== undefined ? { seamId: conflict.seamId } : {}),
    files: [...conflict.files],
    autoResolvable: conflict.autoResolvable,
    diagnosisRef: { label: "Diagnóstico del conflicto", ref: conflict.diagnosisRef, available: true },
    ...(conflict.resolution !== undefined ? { resolution: { ...conflict.resolution } } : {}),
    ...(decision !== undefined ? { decision: { id: decision.id, kind: decision.kind, status: decision.status } } : {}),
    judgementNote: conflictJudgementNote(conflict.dimension, conflict.autoResolvable)
  };
}

function buildDecisionFocus(model: RunModel, decision: Decision): DecisionFocusView {
  const ctx = decision.context;
  const view: DecisionFocusView = {
    kind: "decision",
    id: decision.id,
    decisionKind: decision.kind,
    label: formatDecisionKind(decision.kind),
    blocking: decision.blocking,
    status: decision.status,
    summary: ctx.question ?? DECISION_SUMMARY[decision.kind],
    context: ctx,
    ...(ctx.question !== undefined ? { question: ctx.question } : {}),
    ...(ctx.options !== undefined ? { options: [...ctx.options] } : {}),
    ...(decision.resolution !== undefined ? { choice: decision.resolution.choice, resolvedAt: decision.resolution.at } : {}),
    nodeIds: [...(ctx.nodeIds ?? [])],
    affectedNodeIds: [...(ctx.nodeIds ?? [])],
    ...(decision.status === "pending" ? { pendingAction: { label: DECISION_PRIMARY_ACTION[decision.kind] } } : {})
  };

  if (ctx.conflictId !== undefined) {
    const c = model.conflicts.get(ctx.conflictId);
    if (c !== undefined) {
      view.conflict = { id: c.id, dimension: c.dimension, status: c.status, diagnosisRef: c.diagnosisRef };
    }
  }

  if (ctx.amendmentId !== undefined) {
    const a = model.amendments.get(ctx.amendmentId);
    if (a !== undefined) {
      const seamId = a.detail.seamId;
      view.amendment = {
        id: a.id,
        changeKind: a.changeKind,
        affects: [...a.affects],
        ...(seamId !== undefined ? { seamId } : {})
      };
      view.affectedNodeIds = [...a.affects];
      if (seamId !== undefined) {
        const s = model.seams.get(seamId);
        if (s !== undefined) view.seam = { id: s.id, name: s.name, revision: s.revision, state: s.state };
      }
    }
  }

  if (decision.kind === "approve_merge" && model.evidence !== undefined) {
    const e = model.evidence;
    view.evidence = {
      tests: e.tests,
      aggregateDiffRef: e.aggregateDiffRef,
      narrativeRef: e.narrativeRef,
      integrationCommit: e.integrationCommit
    };
  }

  return view;
}

function buildEvidenceFocus(model: RunModel, evidence: WorkspaceEvidence): EvidenceFocusView {
  const trace = evidence.invalidationTrace ?? [];
  const flatten = (pick: (entry: InvalidationTraceEntry) => NodeId[]): NodeId[] => {
    const set = new Set<NodeId>();
    for (const entry of trace) for (const id of pick(entry)) set.add(id);
    return [...set];
  };
  const approveMerge = [...model.decisions.values()].find((d) => d.kind === "approve_merge");
  const accepted = approveMerge?.status === "resolved";

  return {
    kind: "evidence",
    tests: evidence.tests,
    aggregateDiffRef: { label: "Diff agregado", ref: evidence.aggregateDiffRef, available: true },
    narrativeRef: { label: "Narrativa del run", ref: evidence.narrativeRef, available: true },
    integrationCommit: evidence.integrationCommit,
    ...(evidence.invalidationTrace !== undefined ? { invalidationTrace: evidence.invalidationTrace } : {}),
    reExecuted: flatten((e) => e.reExecuted),
    reIntegrated: flatten((e) => e.reIntegrated),
    preserved: flatten((e) => e.preserved),
    ...(approveMerge !== undefined ? { approveMergeDecision: { id: approveMerge.id, status: approveMerge.status } } : {}),
    ...(model.metrics !== undefined ? { metrics: { ...model.metrics } } : {}),
    acceptanceCopy: accepted
      ? `Resultado aceptado · ${evidence.tests.pass}/${evidence.tests.total} tests · commit ${evidence.integrationCommit}.`
      : `Resultado listo para revisión · ${evidence.tests.pass}/${evidence.tests.total} tests · commit ${evidence.integrationCommit}.`
  };
}

function missing(target: FocusTarget, message: string): MissingFocusView {
  return { kind: "missing", target, title: "Foco no disponible", message };
}

// ── Entry point ──────────────────────────────────────────────────────────────────

/**
 * `RunModel + FocusTarget → FocusView`. Pure: never mutates the model, never throws.
 * A target absent from the current cut returns a `missing` view so deep-links are
 * safe before the entity appears (and after it is, if the id is wrong).
 */
export function buildFocusView(model: RunModel, target: FocusTarget, options: FocusBuildOptions = {}): FocusView {
  switch (target.kind) {
    case "node": {
      const ws = selectWorkspaceView(model).nodes.find((n) => n.id === target.id);
      if (ws === undefined) {
        return missing(target, `El nodo "${target.id}" todavía no existe en este corte del run.`);
      }
      return buildNodeFocus(model, ws, target.id, options);
    }
    case "seam": {
      const ws = selectWorkspaceView(model).seams.find((s) => s.id === target.id);
      if (ws === undefined) {
        return missing(target, `La costura "${target.id}" todavía no existe en este corte del run.`);
      }
      return buildSeamFocus(model, ws, target.id);
    }
    case "conflict": {
      const conflict = model.conflicts.get(target.id);
      if (conflict === undefined) {
        return missing(target, `El conflicto "${target.id}" todavía no fue detectado en este corte del run.`);
      }
      return buildConflictFocus(model, conflict);
    }
    case "decision": {
      const decision = model.decisions.get(target.id);
      if (decision === undefined) {
        return missing(target, `La decisión "${target.id}" todavía no fue planteada en este corte del run.`);
      }
      return buildDecisionFocus(model, decision);
    }
    case "evidence": {
      const view = selectWorkspaceView(model);
      if (view.evidence === null) {
        return missing(target, "La evidencia final todavía no está disponible: el run no llegó a Disposition.");
      }
      return buildEvidenceFocus(model, view.evidence);
    }
    default:
      return missing(target, "Tipo de foco desconocido.");
  }
}
