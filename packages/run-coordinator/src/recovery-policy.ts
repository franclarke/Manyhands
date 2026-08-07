import type { FailureClass } from "./domain/failures.js";

export type RecoveryAction =
  | "retry_attempt"
  | "request_environment_fix"
  | "switch_executor"
  | "repair_code"
  | "propose_graph_amendment"
  | "propose_artifact_requirement"
  | "discard_candidate"
  | "repair_integration"
  | "raise_local_decision";

export interface RecoveryPolicy {
  failureClass: FailureClass;
  actions: RecoveryAction[];
  automaticRetryBudget: number;
  discardCandidate: boolean;
  requiresEvidence: true;
}

const POLICIES: Record<FailureClass, Omit<RecoveryPolicy, "failureClass">> = {
  transient: { actions: ["retry_attempt"], automaticRetryBudget: 2, discardCandidate: true, requiresEvidence: true },
  environment_auth_executor: { actions: ["request_environment_fix", "switch_executor"], automaticRetryBudget: 0, discardCandidate: true, requiresEvidence: true },
  code_test: { actions: ["repair_code", "propose_graph_amendment"], automaticRetryBudget: 1, discardCandidate: true, requiresEvidence: true },
  contract_decomposition: { actions: ["propose_graph_amendment"], automaticRetryBudget: 0, discardCandidate: true, requiresEvidence: true },
  undeclared_artifact: { actions: ["propose_artifact_requirement"], automaticRetryBudget: 0, discardCandidate: true, requiresEvidence: true },
  scope_unexpected_commit: { actions: ["discard_candidate", "raise_local_decision"], automaticRetryBudget: 0, discardCandidate: true, requiresEvidence: true },
  integration: { actions: ["repair_integration", "propose_graph_amendment"], automaticRetryBudget: 1, discardCandidate: true, requiresEvidence: true },
  shared_infrastructure: { actions: ["raise_local_decision"], automaticRetryBudget: 0, discardCandidate: true, requiresEvidence: true },
  // One retry, then a human. Repairing code is off the table — nobody
  // established the code was wrong — but a single retry is evidence gathering
  // rather than blind hope: a failure that reproduces identically is
  // persistent, and one that does not was transient. Refusing to retry at all
  // would stop a hands-off run on every unmodelled CLI crash, which is the most
  // common failure there is.
  unclassified: { actions: ["retry_attempt", "raise_local_decision"], automaticRetryBudget: 1, discardCandidate: true, requiresEvidence: true }
};

export function recoveryPolicyFor(failureClass: FailureClass): RecoveryPolicy {
  const policy = POLICIES[failureClass];
  return { failureClass, ...policy, actions: [...policy.actions] };
}
