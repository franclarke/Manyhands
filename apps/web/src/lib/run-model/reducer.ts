/**
 * Run model reducer — the pure fold `(model, event) => model`.
 *
 * Source of truth: docs/design/run-operative-model.md §4 (frozen). PR 04 of the
 * implementation plan. PURE and deterministic: no React, no browser, no server,
 * no SSE, no side effects. The SAME reducer serves fixtures and the live stream.
 *
 * It builds a normalized `RunModel` of ENTITIES only. It does NOT derive
 * `phase`, `health`, `wavefront`, `attention`, `freshness`, `invalidatedNodes`,
 * `affectedByAmendment`, `pendingReexecution` or `renderableNodeState` — those
 * are selectors (PR 05). It records `builtAgainst`/`producedRevision` so PR 05 can
 * derive freshness; it never marks nodes stale and there is no `node.invalidated`.
 *
 * Ordering & idempotency:
 *  - Events with `seq <= model.cursor` are ignored (replay / out-of-order).
 *  - Applied events advance `cursor` to their `seq`.
 *  - Unknown event types are acknowledged (cursor advances) but change nothing
 *    (forward-compatibility). Events are assumed to arrive in `seq` order; the
 *    reducer does not sort.
 */
import type {
  Amendment,
  AmendmentAppliedPayload,
  AmendmentProposedPayload,
  Conflict,
  ConflictDetectedPayload,
  ConflictResolvedPayload,
  Decision,
  DecisionRaisedPayload,
  DecisionResolvedPayload,
  Evidence,
  ExecutionState,
  IntegrationCompletedPayload,
  IntegrationValidatedPayload,
  Node,
  NodeExecutionFailedPayload,
  NodeExecutionStartedPayload,
  NodePlanningStatus,
  NodeVerifyIterationPayload,
  NodeVerifyPassedPayload,
  PlanNodeProposedPayload,
  PlanNodeStatusPayload,
  PlanSeamProposedPayload,
  Run,
  RunContextResolvedPayload,
  RunCreatedPayload,
  RunEvent,
  RunEvidenceReadyPayload,
  RunModel,
  ScopeDerivedPayload,
  Seam,
  SeamAmendedPayload,
  SeamFrozenPayload,
  Wave,
  WaveClosedPayload,
  WaveOpenedPayload,
  WavePlannedPayload
} from "./types";

// ── Construction ──────────────────────────────────────────────────────────────

export function createInitialRunModel(run: Run): RunModel {
  return {
    run,
    nodes: new Map(),
    seams: new Map(),
    waves: new Map(),
    conflicts: new Map(),
    decisions: new Map(),
    amendments: new Map(),
    cursor: 0
  };
}

// ── Public fold API ────────────────────────────────────────────────────────────

export function reduceRunEvent(model: RunModel, event: RunEvent): RunModel {
  // Replay / out-of-order: ignore anything we've already passed.
  if (event.seq <= model.cursor) {
    return model;
  }
  const applied = applyEvent(model, event);
  // Always advance the cursor (even for unknown/no-op events) to keep the
  // append-only stream monotonic and idempotent on re-application.
  return { ...applied, cursor: event.seq };
}

export function reduceRunEvents(initial: RunModel, events: readonly RunEvent[]): RunModel {
  let model = initial;
  for (const event of events) {
    model = reduceRunEvent(model, event);
  }
  return model;
}

/** Centralizes the `payload` narrowing. The reducer knows the type from the
 *  switch; the envelope's payload is `Record<string, unknown>` by contract. */
function read<T>(event: RunEvent): T {
  return event.payload as unknown as T;
}

// ── Per-event entity updates (cursor handled by reduceRunEvent) ─────────────────

function applyEvent(model: RunModel, event: RunEvent): RunModel {
  switch (event.type) {
    // ── Framing ──
    case "run.created": {
      const p = read<RunCreatedPayload>(event);
      return { ...model, run: { ...model.run, intent: p.intent, workspaceId: p.workspaceId, config: p.config } };
    }
    case "run.context.resolved": {
      const p = read<RunContextResolvedPayload>(event);
      return { ...model, run: { ...model.run, context: { repo: p.repo, baseCommit: p.baseCommit, readiness: p.readiness } } };
    }
    case "run.completed":
      // No model field for run outcome; phase/disposition is derived (PR 05).
      return model;

    // ── Proposal ──
    case "plan.started":
    case "plan.ready":
      // Milestone-only events. Phase is derived from entities (PR 05).
      return model;
    case "plan.node.proposed": {
      const p = read<PlanNodeProposedPayload>(event);
      const existing = model.nodes.get(p.nodeId);
      const node: Node = {
        id: p.nodeId,
        parentId: p.parentId,
        role: p.role,
        title: p.title,
        goal: p.goal,
        depth: p.depth,
        scope: existing?.scope ?? { paths: [], origin: "guessed" },
        produces: existing?.produces ?? [],
        consumes: existing?.consumes ?? [],
        execution: existing?.execution ?? { kind: "idle" },
        ...(existing?.builtAgainst !== undefined ? { builtAgainst: existing.builtAgainst } : {}),
        ...(existing?.producedRevision !== undefined ? { producedRevision: existing.producedRevision } : {}),
        ...(existing?.changedFiles !== undefined ? { changedFiles: existing.changedFiles } : {}),
        ...(existing?.planning !== undefined ? { planning: existing.planning } : {})
      };
      return withNode(model, node);
    }
    case "plan.node.status": {
      const p = read<PlanNodeStatusPayload>(event);
      const node = ensureNode(model, p.nodeId);
      const planning: NodePlanningStatus = {
        state: p.state,
        ...(p.attempt !== undefined ? { attempt: p.attempt } : {}),
        ...(p.maxAttempts !== undefined ? { maxAttempts: p.maxAttempts } : {}),
        ...(p.durationMs !== undefined ? { durationMs: p.durationMs } : {}),
        ...(p.errorKind !== undefined ? { errorKind: p.errorKind } : {}),
        ...(p.errorMessage !== undefined ? { errorMessage: p.errorMessage } : {})
      };
      // Planning telemetry is an ORTHOGONAL record: it never touches `execution`.
      return withNode(model, { ...node, planning });
    }
    case "plan.seam.proposed": {
      const p = read<PlanSeamProposedPayload>(event);
      const seams = new Map(model.seams);
      seams.set(p.seamId, {
        id: p.seamId,
        name: p.name,
        producerNodeId: p.producerNodeId,
        consumerNodeIds: [...p.consumerNodeIds],
        signature: { draft: p.draftSignature },
        revision: 0,
        state: "draft"
      });
      // Populate structural produce/consume edges the freshness selector needs.
      const nodes = new Map(model.nodes);
      const producer = nodes.get(p.producerNodeId) ?? minimalNode(p.producerNodeId);
      nodes.set(producer.id, { ...producer, produces: addUnique(producer.produces, p.seamId) });
      for (const cid of p.consumerNodeIds) {
        const consumer = nodes.get(cid) ?? minimalNode(cid);
        nodes.set(cid, { ...consumer, consumes: addUnique(consumer.consumes, p.seamId) });
      }
      return { ...model, seams, nodes };
    }

    // ── Foundation ──
    case "grounding.started":
    case "skeleton.file.committed":
    case "grounding.completed":
      // Acknowledged; no entity to create. Grounding progress is derived (PR 05).
      return model;
    case "seam.frozen": {
      const p = read<SeamFrozenPayload>(event);
      const seam = model.seams.get(p.seamId);
      const updated: Seam = seam
        ? { ...seam, revision: p.revision, signature: { ...seam.signature, frozen: p.frozenSignature, extractedFrom: p.extractedFrom }, state: "frozen" }
        : { id: p.seamId, name: p.seamId, producerNodeId: "", consumerNodeIds: [], signature: { draft: p.frozenSignature, frozen: p.frozenSignature, extractedFrom: p.extractedFrom }, revision: p.revision, state: "frozen" };
      return withSeam(model, updated);
    }
    case "scope.derived": {
      const p = read<ScopeDerivedPayload>(event);
      const node = ensureNode(model, p.nodeId);
      return withNode(model, { ...node, scope: { origin: "derived", paths: [...p.paths] } });
    }
    case "wave.planned": {
      const p = read<WavePlannedPayload>(event);
      const waves = new Map(model.waves);
      for (const plan of p.waves) {
        waves.set(plan.waveId, { id: plan.waveId, index: plan.index, nodeIds: [...plan.nodeIds], unlockedBySeams: [...plan.unlockedBySeams] });
      }
      return { ...model, waves };
    }

    // ── Supervision ──
    case "wave.opened": {
      const p = read<WaveOpenedPayload>(event);
      const existing = model.waves.get(p.waveId);
      const wave: Wave = existing
        ? { ...existing, opened: true }
        : { id: p.waveId, index: 0, nodeIds: [...p.nodeIds], unlockedBySeams: [], opened: true };
      return withWave(model, wave);
    }
    case "wave.closed": {
      const p = read<WaveClosedPayload>(event);
      const existing = model.waves.get(p.waveId);
      if (!existing) return model;
      return withWave(model, { ...existing, closed: true });
    }
    case "node.execution.started": {
      const p = read<NodeExecutionStartedPayload>(event);
      const node = ensureNode(model, p.nodeId);
      return withNode(model, { ...node, execution: { kind: "running", agent: p.agent, model: p.model } });
    }
    case "node.verify.iteration": {
      const p = read<NodeVerifyIterationPayload>(event);
      const node = ensureNode(model, p.nodeId);
      const execution: ExecutionState = {
        kind: "verifying",
        loop: { iteration: p.iteration, maxIterations: p.maxIterations, build: p.build, testsPass: p.testsPass, testsTotal: p.testsTotal }
      };
      return withNode(model, { ...node, execution });
    }
    case "node.verify.passed": {
      const p = read<NodeVerifyPassedPayload>(event);
      const node = ensureNode(model, p.nodeId);
      const updated: Node = {
        ...node,
        execution: { kind: "integrated", commit: p.commit },
        builtAgainst: [...p.builtAgainst],
        changedFiles: [...p.changedFiles]
      };
      if (p.produces !== undefined) updated.producedRevision = p.produces;
      return withNode(model, updated);
    }
    case "node.verify.failed":
      // A failed ITERATION is non-terminal (repair/iteration follow). Keep the
      // node `verifying`; the terminal signal is `node.execution.failed`.
      return model;
    case "node.repair.started":
      // Autonomous repair: acknowledged, never raises human attention.
      return model;
    case "node.execution.failed": {
      const p = read<NodeExecutionFailedPayload>(event);
      const node = ensureNode(model, p.nodeId);
      return withNode(model, { ...node, execution: { kind: "failed", cause: p.cause } });
    }

    // ── Amendment / seam evolution ──
    case "amendment.proposed": {
      const p = read<AmendmentProposedPayload>(event);
      return withAmendment(model, {
        id: p.amendmentId,
        nodeId: p.nodeId,
        kind: p.kind,
        changeKind: p.changeKind,
        detail: p.detail,
        affects: [...p.affects],
        status: "proposed"
      });
    }
    case "seam.amended": {
      const p = read<SeamAmendedPayload>(event);
      const base: Seam = model.seams.get(p.seamId) ?? {
        id: p.seamId, name: p.seamId, producerNodeId: "", consumerNodeIds: [], signature: { draft: "" }, revision: 0, state: "draft"
      };
      const updated: Seam = { ...base, revision: p.revision, state: "amended", lastChangeKind: p.changeKind };
      if (p.signature !== undefined) updated.signature = { ...base.signature, frozen: p.signature };
      if (p.contract !== undefined) updated.contract = { ...(base.contract ?? {}), ...p.contract };
      // NOTE: seam.amended updates the seam ONLY. It never marks nodes stale —
      // invalidation is derived from revision + changeKind comparison in PR 05.
      return withSeam(model, updated);
    }
    case "amendment.applied": {
      const p = read<AmendmentAppliedPayload>(event);
      const amendment = model.amendments.get(p.amendmentId);
      if (!amendment) return model;
      return withAmendment(model, { ...amendment, status: "applied" });
    }

    // ── Decisions ──
    case "decision.raised": {
      const p = read<DecisionRaisedPayload>(event);
      return withDecision(model, {
        id: p.decisionId,
        kind: p.kind,
        blocking: p.blocking,
        context: p.context,
        status: "pending"
      });
    }
    case "decision.resolved": {
      const p = read<DecisionResolvedPayload>(event);
      const decision = model.decisions.get(p.decisionId);
      if (!decision) return model;
      const resolved: Decision = { ...decision, status: "resolved", resolution: { choice: p.choice, actor: p.actor, at: event.at } };
      return withDecision(model, resolved);
    }

    // ── Conflicts ──
    case "conflict.detected": {
      const p = read<ConflictDetectedPayload>(event);
      return withConflict(model, {
        id: p.conflictId,
        dimension: p.dimension,
        status: p.status,
        nodeIds: [...p.nodeIds],
        ...(p.seamId !== undefined ? { seamId: p.seamId } : {}),
        files: [...p.files],
        autoResolvable: p.autoResolvable,
        diagnosisRef: p.diagnosisRef
      });
    }
    case "conflict.resolved": {
      const p = read<ConflictResolvedPayload>(event);
      const conflict = model.conflicts.get(p.conflictId);
      if (!conflict) return model;
      // A conflict is resolved ONLY by conflict.resolved — never by decision.resolved.
      return withConflict(model, { ...conflict, status: "resolved", resolution: { by: p.by, resolutionId: p.resolutionId } });
    }

    // ── Integration / reconciliation ──
    case "integration.started":
      // Acknowledged; the composite reaches `integrated` at integration.completed.
      // In-progress integration is derived (leaves done + composite not integrated).
      return model;
    case "integration.validated": {
      const p = read<IntegrationValidatedPayload>(event);
      const node = ensureNode(model, p.compositeNodeId);
      // Store builtAgainst (freshness input). A passed:false validation is
      // NON-terminal (a conflict or re-integration follows): we do NOT flip the
      // composite to `failed` here; it only becomes `integrated` at completion.
      const updated: Node = { ...node };
      if (p.builtAgainst !== undefined) updated.builtAgainst = [...p.builtAgainst];
      return withNode(model, updated);
    }
    case "integration.completed": {
      const p = read<IntegrationCompletedPayload>(event);
      const node = ensureNode(model, p.compositeNodeId);
      const execution: ExecutionState = p.status === "success" ? { kind: "integrated", commit: p.commit } : { kind: "failed", cause: `integration ${p.status}` };
      return withNode(model, { ...node, execution });
    }

    // ── Disposition ──
    case "run.evidence.ready": {
      const p = read<RunEvidenceReadyPayload>(event);
      const evidence: Evidence = {
        aggregateDiffRef: p.aggregateDiffRef,
        tests: p.tests,
        narrativeRef: p.narrativeRef,
        integrationCommit: p.integrationCommit,
        ...(p.invalidationTrace !== undefined ? { invalidationTrace: p.invalidationTrace } : {})
      };
      return { ...model, evidence };
    }

    // ── Forward-compat: unknown / v2 events are acknowledged, not applied ──
    default:
      return model;
  }
}

// ── Immutable map helpers ───────────────────────────────────────────────────

function withNode(model: RunModel, node: Node): RunModel {
  const nodes = new Map(model.nodes);
  nodes.set(node.id, node);
  return { ...model, nodes };
}

function withSeam(model: RunModel, seam: Seam): RunModel {
  const seams = new Map(model.seams);
  seams.set(seam.id, seam);
  return { ...model, seams };
}

function withWave(model: RunModel, wave: Wave): RunModel {
  const waves = new Map(model.waves);
  waves.set(wave.id, wave);
  return { ...model, waves };
}

function withDecision(model: RunModel, decision: Decision): RunModel {
  const decisions = new Map(model.decisions);
  decisions.set(decision.id, decision);
  return { ...model, decisions };
}

function withConflict(model: RunModel, conflict: Conflict): RunModel {
  const conflicts = new Map(model.conflicts);
  conflicts.set(conflict.id, conflict);
  return { ...model, conflicts };
}

function withAmendment(model: RunModel, amendment: Amendment): RunModel {
  const amendments = new Map(model.amendments);
  amendments.set(amendment.id, amendment);
  return { ...model, amendments };
}

function ensureNode(model: RunModel, id: string): Node {
  return model.nodes.get(id) ?? minimalNode(id);
}

function minimalNode(id: string): Node {
  return {
    id,
    parentId: null,
    role: "leaf",
    title: "",
    goal: "",
    depth: 0,
    scope: { paths: [], origin: "guessed" },
    produces: [],
    consumes: [],
    execution: { kind: "idle" }
  };
}

function addUnique(list: readonly string[], value: string): string[] {
  return list.includes(value) ? [...list] : [...list, value];
}
