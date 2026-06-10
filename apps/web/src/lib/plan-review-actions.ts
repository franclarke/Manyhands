import type { PlanReviewSummary } from "./plan-review";

export interface PlanReviewApprovalState {
  label: string;
  disabled: boolean;
}

export interface PlanReviewGateState {
  shouldOpenGate: boolean;
  acknowledgeCriticErrorsOnConfirm: boolean;
}

export function planReviewApprovalState(summary: PlanReviewSummary): PlanReviewApprovalState {
  if (summary.status === "errors") {
    // Block with override: the user can force approval after reviewing the
    // errors in the gate (the confirm acknowledges them server-side).
    return {
      label: "Approve despite errors",
      disabled: false
    };
  }
  if (summary.status === "warnings") {
    return {
      label: "Approve with warnings",
      disabled: false
    };
  }
  return {
    label: "Approve plan",
    disabled: false
  };
}

export function planReviewGateState(summary: PlanReviewSummary | null): PlanReviewGateState {
  return {
    shouldOpenGate: summary !== null,
    acknowledgeCriticErrorsOnConfirm: (summary?.issueCounts.errors ?? 0) > 0
  };
}
