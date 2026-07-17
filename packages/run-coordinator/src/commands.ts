import type { DecisionInput } from "./domain/decisions.js";
import type { RunEventDraft } from "./domain/events.js";
import type { RunProjection } from "./reducer.js";

export type RunCommand =
  | { type: "propose_graph"; graphId: string; revision: number }
  | { type: "approve_graph"; graphId: string; revision: number }
  | { type: "raise_decision"; decision: DecisionInput }
  | { type: "resolve_decision"; decisionId: string; optionId?: string; answer?: string }
  | { type: "observe_readiness"; readyNodeIds: string[]; pendingDecisionIds: string[] }
  | { type: "pause"; reason: string }
  | { type: "resume"; reason: string }
  | { type: "verify_final_candidate"; manifestId: string; commit: string; evidenceEligible: boolean; executionSucceeded: boolean }
  | { type: "publish_delivery"; destination: string }
  | { type: "cancel"; reason: string }
  | { type: "fail"; reason: string; area: "execution" | "artifact" | "delivery" | "domain" };

export function eventsForCommand(state: RunProjection, command: Exclude<RunCommand, { type: "publish_delivery" } | { type: "cancel" }>): RunEventDraft[] {
  switch (command.type) {
    case "propose_graph": return [{ type: "graph.revision.proposed", payload: { graphId: command.graphId, revision: command.revision } }];
    case "approve_graph": return [{ type: "graph.revision.approved", payload: { graphId: command.graphId, revision: command.revision } }];
    case "raise_decision": return [{ type: "decision.raised", payload: { decision: command.decision } }];
    case "resolve_decision": return [{ type: "decision.resolved", payload: { decisionId: command.decisionId, ...(command.optionId !== undefined ? { optionId: command.optionId } : {}), ...(command.answer !== undefined ? { answer: command.answer } : {}) } }];
    case "observe_readiness": return [{ type: "readiness.observed", payload: { readyNodeIds: command.readyNodeIds, pendingDecisionIds: command.pendingDecisionIds } }];
    case "pause": return [{ type: "run.pause_requested", payload: { reason: command.reason } }];
    case "resume": return [{ type: "run.resume_requested", payload: { reason: command.reason } }];
    case "verify_final_candidate": return [{ type: "final_candidate.verified", payload: { manifestId: command.manifestId, commit: command.commit, evidenceEligible: command.evidenceEligible, executionSucceeded: command.executionSucceeded } }];
    case "fail": return [{ type: "run.failed", payload: { reason: command.reason, area: command.area } }];
  }
}
