/**
 * Run model selectors — the pure derivation layer.
 *
 * Source of truth: docs/design/run-operative-model.md §5 (frozen). PR 05 of the
 * implementation plan. Every selector is `(model) => derivedView`, PURE and
 * read-only: it never mutates the `RunModel`. The UI consumes THESE, never the
 * raw model. The reducer (PR 04) stores entities only; ALL of phase/health/
 * wavefront/freshness/invalidation is derived here.
 *
 * Frozen rules honoured:
 *  - `freshness` is derived (revision comparison), never persisted; there is no
 *    `node.invalidated` and no `stale` execution state.
 *  - A node is stale only when it built against a seam revision behind the seam's
 *    current revision AND that bump was a SIGNATURE change (a CONTRACT change
 *    enriches semantics and does not invalidate already-correct consumers).
 *  - `selectWavefront` = nodes running/verifying (NOT `Wave.opened`).
 *  - `selectRenderableNodeState` combines execution × freshness; `integrated +
 *    stale` renders `obsolete`, never `done`.
 *  - A conflict is active until `conflict.resolved`; `decision.resolved` alone
 *    does not resolve it.
 *  - Selectors tolerate partial/truncated runs and absent `builtAgainst`.
 */
import type {
  CompositeIntegration,
  Conflict,
  Decision,
  Evidence,
  Freshness,
  GranularityMetrics,
  IntegrationState,
  Node,
  NodeDisplay,
  NodeId,
  NodePlanningStatus,
  PlanningHealth,
  RenderableNodeState,
  RunHealth,
  RunModel,
  RunPhase,
  RunControlStatus
} from "./types";

const TERMINAL_OR_ARTIFACT_CONTROL_STATUSES = new Set<RunControlStatus>([
  "interrupted",
  "completed",
  "completed_with_accepted",
  "partial",
  "unverified",
  "needs_delivery",
  "failed_artifact",
  "failed_delivery",
  "failed"
]);

/** Pending decisions become durable history once the run reaches a terminal or artifact-control state. */
export function hasTerminalOrArtifactControlStatus(status: RunControlStatus): boolean {
  return TERMINAL_OR_ARTIFACT_CONTROL_STATUSES.has(status);
}

// ── Phase ─────────────────────────────────────────────────────────────────────

export function selectPhase(model: RunModel): RunPhase {
  const nodes = [...model.nodes.values()];
  const decisions = [...model.decisions.values()];

  const hasRunningNode = nodes.some((n) => n.execution.kind === "running" || n.execution.kind === "verifying");
  const hasActiveConflict = [...model.conflicts.values()].some((c) => c.status !== "resolved");
  const approveMergeExists = decisions.some((d) => d.kind === "approve_merge");
  const approvePlanResolved = decisions.some((d) => d.kind === "approve_plan" && d.status === "resolved");
  const approvePlanPending = decisions.some((d) => d.kind === "approve_plan" && d.status === "pending");
  const someLeafIntegrated = nodes.some((n) => n.role === "leaf" && n.execution.kind === "integrated");
  const someCompositeOpen = nodes.some(
    (n) => (n.role === "composite" || n.role === "root") && n.execution.kind !== "integrated"
  );
  const hasGroundingSignals =
    [...model.seams.values()].some((s) => s.state === "frozen" || s.state === "amended") ||
    model.waves.size > 0 ||
    nodes.some((n) => n.scope.origin === "derived");
  const hasProposalSignals =
    nodes.length > 0 || decisions.some((d) => d.kind === "approve_plan" || d.kind === "clarify");

  if (model.evidence !== undefined || approveMergeExists) return "disposition";
  if (approvePlanPending) return "proposal";
  if (hasRunningNode) return "supervision";
  if (hasActiveConflict || (someLeafIntegrated && someCompositeOpen)) return "reconciliation";
  if (approvePlanResolved || hasGroundingSignals) return "foundation";
  if (hasProposalSignals) return "proposal";
  return "framing";
}

// ── Health ────────────────────────────────────────────────────────────────────

export function selectHealth(model: RunModel): RunHealth {
  const nodes = [...model.nodes.values()];

  if (["failed", "failed_artifact", "failed_delivery"].includes(model.run.control.status)) return "failing";
  const hasFailed = nodes.some((n) => n.execution.kind === "failed");
  if (hasFailed) return "failing";

  const hasBlockingPending = [...model.decisions.values()].some((d) => d.status === "pending" && d.blocking);
  const hasUnresolvedHardConflict = [...model.conflicts.values()].some(
    (c) => c.autoResolvable === false && c.status !== "resolved"
  );
  if (hasBlockingPending || hasUnresolvedHardConflict) return "attention";

  const hasWorking = nodes.some((n) => n.execution.kind === "running" || n.execution.kind === "verifying");
  if (hasWorking) return "working";

  return "settled";
}

// ── Planning health (graph-generation telemetry — orthogonal to execution) ─────

/** The latest planning telemetry recorded for a node, or null if it planned cleanly. */
export function selectNodePlanning(model: RunModel, nodeId: NodeId): NodePlanningStatus | null {
  return model.nodes.get(nodeId)?.planning ?? null;
}

/**
 * Which nodes the planner had to retry / fall back / failed to plan. DERIVED from
 * each node's recorded `planning` axis; it is diagnostic only and deliberately does
 * NOT feed `selectAttention` — autonomous planning retries/repair are not human
 * attention. `generating` is normal in-flight and is not reported as a concern.
 */
export function selectPlanningHealth(model: RunModel): PlanningHealth {
  const retrying: NodeId[] = [];
  const fallback: NodeId[] = [];
  const failed: NodeId[] = [];
  for (const node of model.nodes.values()) {
    switch (node.planning?.state) {
      case "retrying":
        retrying.push(node.id);
        break;
      case "fallback":
        fallback.push(node.id);
        break;
      case "failed":
        failed.push(node.id);
        break;
      default:
        break;
    }
  }
  retrying.sort();
  fallback.sort();
  failed.sort();
  return { retrying, fallback, failed, clean: retrying.length === 0 && fallback.length === 0 && failed.length === 0 };
}

// ── Wavefront ─────────────────────────────────────────────────────────────────

export function selectWavefront(model: RunModel): NodeId[] {
  return [...model.nodes.values()]
    .filter((n) => n.execution.kind === "running" || n.execution.kind === "verifying")
    .map((n) => n.id)
    .sort();
}

// ── Attention (pending decisions, blocking first, insertion order within) ──────

export function selectAttention(model: RunModel): Decision[] {
  if (hasTerminalOrArtifactControlStatus(model.run.control.status)) return [];
  const pending = [...model.decisions.values()].filter((d) => d.status === "pending");
  return [...pending.filter((d) => d.blocking), ...pending.filter((d) => !d.blocking)];
}

/** Pending decisions retained for audit after a terminal state. They never receive an active CTA. */
export function selectArchivedAttention(model: RunModel): Decision[] {
  if (!hasTerminalOrArtifactControlStatus(model.run.control.status)) return [];
  return [...model.decisions.values()].filter((decision) => decision.status === "pending");
}

// ── Blocked ───────────────────────────────────────────────────────────────────

export function selectBlocked(model: RunModel): NodeId[] {
  const blocked = new Set<NodeId>();
  for (const node of model.nodes.values()) {
    if (node.execution.kind === "blocked") blocked.add(node.id);
  }
  for (const decision of model.decisions.values()) {
    if (decision.status === "pending" && decision.blocking) {
      for (const id of decision.context.nodeIds ?? []) blocked.add(id);
    }
  }
  return [...blocked];
}

// ── Conflicts (active) ──────────────────────────────────────────────────────────

export function selectConflicts(model: RunModel): Conflict[] {
  return [...model.conflicts.values()].filter((c) => c.status !== "resolved");
}

// ── Evidence ──────────────────────────────────────────────────────────────────

export function selectEvidence(model: RunModel): Evidence | null {
  return model.evidence ?? null;
}

// ── Run metrics (legacy GranularityVector name) ───────────────────

/** The run's granularity metrics, or null until `run.metrics.ready`. Pure passthrough. */
export function selectGranularityMetrics(model: RunModel): GranularityMetrics | null {
  return model.metrics ?? null;
}

// ── Integration progress (Reconciliation — derived, no new backend event) ───────

/**
 * Per-composite reconciliation progress, derived from node state alone:
 * `integrated`/`failed` from the composite's execution; `ready` when every direct
 * child is integrated but the composite is not yet (integration imminent / running);
 * `pending` otherwise. Bottom-up: a child composite counts as done once integrated.
 */
export function selectIntegrationProgress(model: RunModel): CompositeIntegration[] {
  return [...model.nodes.values()]
    .filter((n) => n.role === "composite" || n.role === "root")
    .map((c) => {
      const children = childrenOf(model, c.id);
      const totalChildCount = children.length;
      const doneChildCount = children.filter((ch) => ch.execution.kind === "integrated").length;
      let state: IntegrationState;
      if (c.execution.kind === "integrated") state = "integrated";
      else if (c.execution.kind === "failed") state = "failed";
      else if (totalChildCount > 0 && doneChildCount === totalChildCount) state = "ready";
      else state = "pending";
      return { id: c.id, state, childIds: children.map((ch) => ch.id), doneChildCount, totalChildCount };
    });
}

// ── Freshness & invalidation ────────────────────────────────────────────────────

function childrenOf(model: RunModel, parentId: NodeId): Node[] {
  return [...model.nodes.values()].filter((n) => n.parentId === parentId);
}

function freshnessOf(model: RunModel, nodeId: NodeId, visited: Set<NodeId>): Freshness {
  if (visited.has(nodeId)) return "fresh"; // cycle guard (DAG should be acyclic)
  visited.add(nodeId);

  const node = model.nodes.get(nodeId);
  if (node === undefined) return "fresh"; // missing node is not stale (policy)

  // Direct rule: built against a revision behind a seam whose latest change was a
  // SIGNATURE change. Contract changes do not invalidate; draft/missing seams skip.
  for (const ref of node.builtAgainst ?? []) {
    const seam = model.seams.get(ref.seamId);
    if (seam === undefined || seam.state === "draft") continue;
    if (ref.revision < seam.revision && seam.lastChangeKind === "signature") return "stale";
  }

  // Composite rule: a composite is stale if any descendant is stale.
  for (const child of childrenOf(model, nodeId)) {
    if (freshnessOf(model, child.id, visited) === "stale") return "stale";
  }

  return "fresh";
}

export function selectFreshness(model: RunModel, nodeId: NodeId): Freshness {
  return freshnessOf(model, nodeId, new Set());
}

export function selectInvalidatedNodes(model: RunModel): NodeId[] {
  return [...model.nodes.values()]
    .filter((n) => selectFreshness(model, n.id) === "stale")
    .map((n) => n.id)
    .sort();
}

// ── Amendment blast radius (projected snapshot; distinct from invalidation) ─────

export function selectAffectedByAmendment(model: RunModel, amendmentId: string): NodeId[] {
  const amendment = model.amendments.get(amendmentId);
  if (amendment === undefined) return [];
  // The as-proposed snapshot recorded on the amendment (audit / decision support).
  // This is intentionally NOT the live invalidation set (`selectInvalidatedNodes`).
  return [...amendment.affects];
}

// ── Pending re-execution ────────────────────────────────────────────────────────

export function selectPendingReexecution(model: RunModel): NodeId[] {
  return selectInvalidatedNodes(model).filter((id) => {
    const node = model.nodes.get(id);
    if (node === undefined) return false;
    return node.execution.kind !== "running" && node.execution.kind !== "verifying";
  });
}

// ── Renderable node state (the ONLY thing the UI uses to paint a node) ─────────

export function selectRenderableNodeState(model: RunModel, nodeId: NodeId): RenderableNodeState {
  const node = model.nodes.get(nodeId);
  if (node === undefined) {
    return { display: "idle", lifecycle: "idle", freshness: "fresh", obsolete: false };
  }

  const freshness = selectFreshness(model, nodeId);
  const kind = node.execution.kind;
  let display: NodeDisplay;
  let obsolete = false;

  switch (kind) {
    case "failed":
      display = "failed";
      break;
    case "blocked":
      display = "blocked";
      break;
    case "running":
    case "grounding":
      display = "running";
      break;
    case "verifying":
      display = "verifying";
      break;
    case "integrated":
      if (freshness === "stale") {
        display = "obsolete";
        obsolete = true;
      } else {
        display = "done";
      }
      break;
    case "idle":
    default:
      display = "idle";
      break;
  }

  // A pending blocking decision that references this node supersedes the
  // active displays: the run is paused waiting for the human, so painting
  // "Verificando"/"Reparando" would lie (postmortem bug). Derived purely from
  // the decision log — resolving the gate restores the display by itself.
  if ((display === "running" || display === "verifying") && hasPendingBlockingDecision(model, nodeId)) {
    display = "gated";
  }

  const verify = node.execution.kind === "verifying" ? node.execution.loop : undefined;
  return { display, lifecycle: kind, freshness, obsolete, ...(verify !== undefined ? { verify } : {}) };
}

function hasPendingBlockingDecision(model: RunModel, nodeId: NodeId): boolean {
  for (const decision of model.decisions.values()) {
    if (
      decision.status === "pending" &&
      decision.blocking &&
      decision.kind !== "approve_plan" &&
      (decision.context.nodeIds?.includes(nodeId) ?? false)
    ) {
      return true;
    }
  }
  return false;
}
