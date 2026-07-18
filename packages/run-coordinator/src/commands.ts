import type { DecisionInput } from "./domain/decisions.js";
import type { RunEventDraft } from "./domain/events.js";
import type { RunProjection } from "./reducer.js";
import type { FailureObservation } from "./domain/failures.js";
import { classifyFailure } from "./domain/failures.js";
import { recoveryPolicyFor } from "./recovery-policy.js";
import type { GraphAmendmentProposal } from "./amendments.js";
import type { EvidenceMatrixRecord } from "./domain/evidence.js";
import type { DeliveryApproval } from "./domain/outcomes.js";

export type RunCommand =
  | { type: "propose_graph"; graphId: string; revision: number }
  | { type: "approve_graph"; graphId: string; revision: number }
  | { type: "raise_decision"; decision: DecisionInput }
  | { type: "resolve_decision"; decisionId: string; optionId?: string; answer?: string }
  | { type: "observe_readiness"; readyNodeIds: string[]; pendingDecisionIds: string[] }
  | { type: "select_wave"; waveId: string; nodeIds: string[]; maxParallel: number }
  | { type: "record_failure"; nodeId: string; observation: FailureObservation }
  | { type: "propose_amendment"; proposal: GraphAmendmentProposal }
  | { type: "record_evidence_matrix"; matrix: EvidenceMatrixRecord }
  | { type: "pause"; reason: string }
  | { type: "resume"; reason: string }
  | { type: "restart"; reason: string }
  | { type: "verify_final_candidate"; manifestId: string; commit: string; evidenceMatrixId: string; evidenceEligible: boolean; executionSucceeded: boolean; sourceTargetFingerprint: string; targetBranch: string; targetHead: string }
  | { type: "publish_delivery"; approval: DeliveryApproval }
  | { type: "cancel"; reason: string }
  | { type: "fail"; reason: string; area: "execution" | "artifact" | "delivery" | "domain" };

export function eventsForCommand(state: RunProjection, command: Exclude<RunCommand, { type: "publish_delivery" } | { type: "cancel" }>): RunEventDraft[] {
  switch (command.type) {
    case "propose_graph": return [{ type: "graph.revision.proposed", payload: { graphId: command.graphId, revision: command.revision } }];
    case "approve_graph": return [{ type: "graph.revision.approved", payload: { graphId: command.graphId, revision: command.revision } }];
    case "raise_decision": return [{ type: "decision.raised", payload: { decision: command.decision } }];
    case "resolve_decision": return [{ type: "decision.resolved", payload: { decisionId: command.decisionId, ...(command.optionId !== undefined ? { optionId: command.optionId } : {}), ...(command.answer !== undefined ? { answer: command.answer } : {}) } }];
    case "observe_readiness": return [{ type: "readiness.observed", payload: { readyNodeIds: command.readyNodeIds, pendingDecisionIds: command.pendingDecisionIds } }];
    case "select_wave": return [{ type: "wave.selected", payload: { waveId: command.waveId, nodeIds: command.nodeIds, maxParallel: command.maxParallel } }];
    case "record_failure": {
      const failureClass = classifyFailure(command.observation);
      const policy = recoveryPolicyFor(failureClass);
      return [{ type: "failure.classified", payload: { nodeId: command.nodeId, failureClass, observation: command.observation, allowedActions: policy.actions, automaticRetryBudget: policy.automaticRetryBudget, discardCandidate: policy.discardCandidate } }];
    }
    case "propose_amendment": return [{ type: "graph.amendment.proposed", payload: { ...command.proposal, operations: command.proposal.operations.map((operation) => operation as unknown as Record<string, unknown>) } }];
    case "record_evidence_matrix": return [{ type: "evidence.matrix_recorded", payload: { matrix: command.matrix } }];
    case "pause": return [{ type: "run.pause_requested", payload: { reason: command.reason } }];
    case "resume": return [{ type: "run.resume_requested", payload: { reason: command.reason } }];
    case "restart": return [{ type: "run.restart_requested", payload: { reason: command.reason } }];
    case "verify_final_candidate": return [{ type: "final_candidate.verified", payload: { manifestId: command.manifestId, commit: command.commit, evidenceMatrixId: command.evidenceMatrixId, evidenceEligible: command.evidenceEligible, executionSucceeded: command.executionSucceeded, sourceTargetFingerprint: command.sourceTargetFingerprint, targetBranch: command.targetBranch, targetHead: command.targetHead } }];
    case "fail": return [{ type: "run.failed", payload: { reason: command.reason, area: command.area } }];
  }
}
