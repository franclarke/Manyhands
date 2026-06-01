import type { PlanReviewSummary } from "./plan-review";

export interface PlanReviewApprovalState {
  label: string;
  disabled: boolean;
}

export function planReviewApprovalState(summary: PlanReviewSummary): PlanReviewApprovalState {
  if (summary.status === "errors") {
    return {
      label: "Resolve errors before approval",
      disabled: true
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
