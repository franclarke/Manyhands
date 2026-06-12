/**
 * Decision channel — view projection + fixture-resolution helpers (PR 07).
 *
 * Two pure concerns, kept testable outside React:
 *
 *  1) `buildDecisionChannelView(model)` — a MODEL-ONLY projection of the human
 *     decision surface (via `selectAttention`, blocking-first), with each
 *     decision's context resolved into displayable refs (conflict / amendment /
 *     seam / evidence / question+options). It is NOT a notification center: it
 *     surfaces only what needs human judgement, and empty = success.
 *
 *  2) `findDecisionResolutionEvent` / `advanceFixtureToDecisionResolution` —
 *     prototype-only helpers that "resolve" a decision by FAST-FORWARDING the
 *     fixture to its EXISTING `decision.resolved` event. They never invent events
 *     with made-up `seq` (that would fight the reducer's `seq <= cursor`
 *     idempotency and create a second source of truth); they only return a slice
 *     of events that already exist in the fixture.
 *
 * This module never mutates a `RunModel`. Resolution is applied by the player
 * (`useFixturePlayback`) through the existing pure reducer.
 */
import { formatAttentionSummary } from "./proto-view";
import { selectAttention, selectWavefront } from "./selectors";
import type {
  AmendmentChangeKind,
  AmendmentId,
  AmendmentKind,
  ConflictDimension,
  ConflictId,
  ConflictStatus,
  DecisionId,
  DecisionKind,
  NodeId,
  RunEvent,
  RunModel,
  SeamId,
  SeamState,
  TestSummary
} from "./types";

// ── View shapes ─────────────────────────────────────────────────────────────────

export interface DecisionConflictRef {
  id: ConflictId;
  dimension: ConflictDimension;
  status: ConflictStatus;
  diagnosisRef: string;
  nodeIds: NodeId[];
  seamId?: SeamId;
}

export interface DecisionAmendmentRef {
  id: AmendmentId;
  kind: AmendmentKind;
  changeKind: AmendmentChangeKind;
  affects: NodeId[];
  seamId?: SeamId;
}

export interface DecisionSeamRef {
  id: SeamId;
  name: string;
  revision: number;
  state: SeamState;
}

export interface DecisionEvidenceRef {
  tests: TestSummary;
  aggregateDiffRef: string;
  narrativeRef: string;
  integrationCommit: string;
}

export interface DecisionChannelItem {
  id: DecisionId;
  kind: DecisionKind;
  label: string;
  blocking: boolean;
  summary: string;
  primaryActionLabel: string;
  affectedNodeIds: NodeId[];
  question?: string;
  options?: string[];
  conflict?: DecisionConflictRef;
  amendment?: DecisionAmendmentRef;
  seam?: DecisionSeamRef;
  evidence?: DecisionEvidenceRef;
}

export interface DecisionChannelView {
  empty: boolean;
  /** Success-first copy when nothing needs judgement (never an awkward void). */
  emptyCopy: string;
  /** Pending decisions, blocking-first (the order from `selectAttention`). */
  items: DecisionChannelItem[];
}

// ── Labels / copy ────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<DecisionKind, string> = {
  approve_plan: "Aprobar plan",
  clarify: "Aclaración",
  resolve_conflict: "Resolver conflicto",
  approve_amendment: "Aprobar enmienda",
  approve_merge: "Aprobar merge"
};

const PRIMARY_ACTION: Record<DecisionKind, string> = {
  approve_plan: "Aprobar plan",
  clarify: "Responder",
  resolve_conflict: "Resolver conflicto",
  approve_amendment: "Aprobar enmienda",
  approve_merge: "Aceptar resultado"
};

export function formatDecisionKind(kind: DecisionKind): string {
  return KIND_LABEL[kind];
}

function summaryFor(kind: DecisionKind, question: string | undefined): string {
  switch (kind) {
    case "approve_plan":
      return "Aprobá el plan para comenzar la ejecución.";
    case "clarify":
      return question ?? "El planner necesita una aclaración para continuar.";
    case "resolve_conflict":
      return "Un conflicto necesita tu juicio para integrarse.";
    case "approve_amendment":
      return "Una enmienda al plan espera tu aprobación.";
    case "approve_merge":
      return "Revisá el resultado y aceptá el merge.";
    default:
      return "";
  }
}

// ── Channel projection (model-only) ──────────────────────────────────────────────

export function buildDecisionChannelView(model: RunModel): DecisionChannelView {
  const pending = selectAttention(model); // already blocking-first
  if (pending.length === 0) {
    return {
      empty: true,
      emptyCopy: formatAttentionSummary(true, selectWavefront(model).length, 0, 0),
      items: []
    };
  }

  const items: DecisionChannelItem[] = pending.map((d) => {
    const ctx = d.context;
    // Execution gates are published as clarify decisions; the planner copy
    // would be misleading there ("Aclaración" reads as a planning question).
    const isExecutionGate = d.kind === "clarify" && ctx.gate !== undefined;
    const item: DecisionChannelItem = {
      id: d.id,
      kind: d.kind,
      label: isExecutionGate ? "Gate de ejecución" : KIND_LABEL[d.kind],
      blocking: d.blocking,
      summary: summaryFor(d.kind, ctx.question),
      primaryActionLabel: isExecutionGate ? "Elegir opción" : PRIMARY_ACTION[d.kind],
      affectedNodeIds: [...(ctx.nodeIds ?? [])],
      ...(ctx.question !== undefined ? { question: ctx.question } : {}),
      ...(ctx.options !== undefined ? { options: [...ctx.options] } : {})
    };

    // resolve_conflict → embed the conflict it points at.
    if (ctx.conflictId !== undefined) {
      const c = model.conflicts.get(ctx.conflictId);
      if (c !== undefined) {
        item.conflict = {
          id: c.id,
          dimension: c.dimension,
          status: c.status,
          diagnosisRef: c.diagnosisRef,
          nodeIds: [...c.nodeIds],
          ...(c.seamId !== undefined ? { seamId: c.seamId } : {})
        };
      }
    }

    // approve_amendment → embed the amendment (and its seam, if it has one).
    if (ctx.amendmentId !== undefined) {
      const a = model.amendments.get(ctx.amendmentId);
      if (a !== undefined) {
        const seamId = a.detail.seamId;
        item.amendment = {
          id: a.id,
          kind: a.kind,
          changeKind: a.changeKind,
          affects: [...a.affects],
          ...(seamId !== undefined ? { seamId } : {})
        };
        if (seamId !== undefined) {
          const s = model.seams.get(seamId);
          if (s !== undefined) {
            item.seam = { id: s.id, name: s.name, revision: s.revision, state: s.state };
          }
        }
      }
    }

    // approve_merge → embed the evidence under review.
    if (d.kind === "approve_merge" && model.evidence !== undefined) {
      const e = model.evidence;
      item.evidence = {
        tests: e.tests,
        aggregateDiffRef: e.aggregateDiffRef,
        narrativeRef: e.narrativeRef,
        integrationCommit: e.integrationCommit
      };
    }

    return item;
  });

  return { empty: false, emptyCopy: "", items };
}

// ── Fixture resolution helpers (prototype-only; NO invented events) ───────────────

export interface DecisionResolutionLocation {
  event: RunEvent;
  index: number;
}

/** The next `decision.resolved` for `decisionId` at or after `fromIndex`, or null. */
export function findDecisionResolutionEvent(
  events: readonly RunEvent[],
  fromIndex: number,
  decisionId: DecisionId
): DecisionResolutionLocation | null {
  for (let i = Math.max(0, fromIndex); i < events.length; i++) {
    const e = events[i]!;
    if (e.type === "decision.resolved" && (e.payload as { decisionId?: string }).decisionId === decisionId) {
      return { event: e, index: i };
    }
  }
  return null;
}

export interface FixtureAdvancePlan {
  /** EXISTING fixture events to apply in order (never invented). */
  apply: RunEvent[];
  /** Playback index after applying — points just past the resolution event. */
  nextIndex: number;
  resolution: DecisionResolutionLocation;
}

/**
 * Plan the fast-forward needed to resolve `decisionId`: the slice of EXISTING
 * fixture events from `fromIndex` up to and including its `decision.resolved`.
 * Returns null when this fixture has no resolution for it (e.g. a trailing
 * `approve_plan` gate that the fixture never answers).
 */
export function advanceFixtureToDecisionResolution(
  events: readonly RunEvent[],
  fromIndex: number,
  decisionId: DecisionId
): FixtureAdvancePlan | null {
  const resolution = findDecisionResolutionEvent(events, fromIndex, decisionId);
  if (resolution === null) return null;
  return {
    apply: events.slice(fromIndex, resolution.index + 1),
    nextIndex: resolution.index + 1,
    resolution
  };
}
