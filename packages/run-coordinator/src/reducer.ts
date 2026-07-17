import { DecisionSchema, type Decision } from "./domain/decisions.js";
import { RunEventSchema, type RunEvent } from "./domain/events.js";
import { assertLifecycleTransition, type RunLifecycle } from "./domain/lifecycle.js";
import { INITIAL_RUN_OUTCOMES, type DeliveryReceipt, type FinalCandidate, type RunOutcomes } from "./domain/outcomes.js";

export interface RunProjection {
  runId: string;
  goal: string;
  lifecycle: RunLifecycle;
  sequence: number;
  appliedEventIds: string[];
  graphId?: string;
  graphRevision?: number;
  approvedGraphRevision?: number;
  decisions: Record<string, Decision>;
  readiness: { readyNodeIds: string[]; pendingDecisionIds: string[] };
  outcomes: RunOutcomes;
  finalCandidate?: FinalCandidate;
  deliveryReceipt?: DeliveryReceipt;
  lifecycleBeforePause?: Extract<RunLifecycle, "running" | "waiting_for_input">;
  failureReason?: string;
}

export function foldRun(rawEvents: readonly RunEvent[]): RunProjection {
  if (rawEvents.length === 0) throw new Error("Cannot fold a run without run.created.");
  let state: RunProjection | undefined;
  const seenEventIds = new Set<string>();
  for (const rawEvent of rawEvents) {
    const event = RunEventSchema.parse(rawEvent);
    if (seenEventIds.has(event.eventId)) throw new Error(`Duplicate run event id ${event.eventId}.`);
    seenEventIds.add(event.eventId);
    if (state === undefined) {
      if (event.type !== "run.created" || event.sequence !== 1) throw new Error("The first run event must be run.created at sequence 1.");
      state = {
        runId: event.runId,
        goal: event.payload.goal,
        lifecycle: "planning",
        sequence: 1,
        appliedEventIds: [event.eventId],
        decisions: {},
        readiness: { readyNodeIds: [], pendingDecisionIds: [] },
        outcomes: { ...INITIAL_RUN_OUTCOMES }
      };
      continue;
    }
    if (event.runId !== state.runId) throw new Error(`Event ${event.eventId} belongs to another run.`);
    if (event.sequence !== state.sequence + 1) throw new Error(`Expected run event sequence ${state.sequence + 1}, received ${event.sequence}.`);
    state = reduceRun(state, event);
  }
  return state as RunProjection;
}

export function reduceRun(state: RunProjection, event: RunEvent): RunProjection {
  const next = structuredClone(state);
  switch (event.type) {
    case "run.created":
      throw new Error("run.created can only be the first event.");
    case "graph.revision.proposed":
      if (next.lifecycle !== "planning" && next.lifecycle !== "needs_approval") throw new Error(`Cannot propose a graph while ${next.lifecycle}.`);
      next.graphId = event.payload.graphId;
      next.graphRevision = event.payload.revision;
      transition(next, "needs_approval");
      break;
    case "graph.revision.approved":
      if (next.graphId !== event.payload.graphId || next.graphRevision !== event.payload.revision) throw new Error(`Cannot approve graph ${event.payload.graphId} revision ${event.payload.revision}; current graph is ${next.graphId ?? "none"} revision ${next.graphRevision ?? "none"}.`);
      next.approvedGraphRevision = event.payload.revision;
      transition(next, "running");
      break;
    case "decision.raised":
      if (next.decisions[event.payload.decision.id] !== undefined) throw new Error(`Decision ${event.payload.decision.id} already exists.`);
      next.decisions[event.payload.decision.id] = DecisionSchema.parse({ ...event.payload.decision, status: "pending" });
      break;
    case "decision.resolved": {
      const decision = next.decisions[event.payload.decisionId];
      if (decision === undefined || decision.status !== "pending") throw new Error(`Decision ${event.payload.decisionId} is not pending.`);
      if (event.payload.optionId !== undefined && !decision.options.some((option) => option.id === event.payload.optionId)) throw new Error(`Decision ${decision.id} has no option ${event.payload.optionId}.`);
      decision.status = "resolved";
      decision.resolution = {
        ...(event.payload.optionId !== undefined ? { optionId: event.payload.optionId } : {}),
        ...(event.payload.answer !== undefined ? { answer: event.payload.answer } : {})
      };
      break;
    }
    case "readiness.observed": {
      for (const decisionId of event.payload.pendingDecisionIds) {
        if (next.decisions[decisionId]?.status !== "pending") throw new Error(`Readiness references non-pending decision ${decisionId}.`);
      }
      next.readiness = { readyNodeIds: [...new Set(event.payload.readyNodeIds)].sort(), pendingDecisionIds: [...new Set(event.payload.pendingDecisionIds)].sort() };
      if (next.lifecycle === "running" || next.lifecycle === "waiting_for_input") {
        transition(next, next.readiness.readyNodeIds.length === 0 && next.readiness.pendingDecisionIds.length > 0 ? "waiting_for_input" : "running");
      }
      break;
    }
    case "run.pause_requested":
      if (next.lifecycle !== "running" && next.lifecycle !== "waiting_for_input") throw new Error(`Cannot pause while ${next.lifecycle}.`);
      next.lifecycleBeforePause = next.lifecycle;
      transition(next, "paused");
      break;
    case "run.resume_requested":
      if (next.lifecycle !== "paused") throw new Error(`Cannot resume while ${next.lifecycle}.`);
      transition(next, next.readiness.readyNodeIds.length === 0 && next.readiness.pendingDecisionIds.length > 0 ? "waiting_for_input" : "running");
      delete next.lifecycleBeforePause;
      break;
    case "operation.cancel_requested":
      transition(next, "cancelling");
      break;
    case "operation.interrupted":
      next.outcomes.execution = "interrupted";
      transition(next, "interrupted");
      break;
    case "final_candidate.verified":
      if (!event.payload.executionSucceeded) throw new Error("A final candidate cannot be verified before execution succeeds.");
      if (!event.payload.evidenceEligible) throw new Error("A final candidate requires eligible evidence.");
      if (Object.values(next.decisions).some((decision) => decision.status === "pending")) throw new Error("A final candidate cannot become ready with pending decisions.");
      next.finalCandidate = { manifestId: event.payload.manifestId, commit: event.payload.commit, evidenceEligible: true };
      next.outcomes = { execution: "succeeded", artifact: "verified", delivery: "ready" };
      transition(next, "result_ready");
      break;
    case "delivery.started":
      if (next.finalCandidate?.manifestId !== event.payload.manifestId) throw new Error(`Delivery manifest ${event.payload.manifestId} is not the verified final candidate.`);
      transition(next, "delivering");
      break;
    case "delivery.published":
      if (!event.payload.receipt.confirmed) throw new Error("Delivery receipt must be confirmed before completed.");
      if (next.finalCandidate?.evidenceEligible !== true || next.finalCandidate.manifestId !== event.payload.receipt.manifestId) throw new Error("Delivery receipt does not match an evidence-eligible final candidate.");
      next.deliveryReceipt = event.payload.receipt;
      next.outcomes.delivery = "published";
      transition(next, "completed");
      break;
    case "run.failed":
      if (event.payload.area === "execution") next.outcomes.execution = "failed";
      if (event.payload.area === "artifact") next.outcomes.artifact = "failed";
      if (event.payload.area === "delivery") next.outcomes.delivery = "failed";
      next.failureReason = event.payload.reason;
      transition(next, "failed");
      break;
  }
  next.sequence = event.sequence;
  next.appliedEventIds.push(event.eventId);
  return next;
}

function transition(state: RunProjection, target: RunLifecycle): void {
  assertLifecycleTransition(state.lifecycle, target);
  state.lifecycle = target;
}
