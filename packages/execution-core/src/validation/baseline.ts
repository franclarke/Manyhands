export type BaselineComparison = "not_run" | "baseline_passed" | "preexisting_failure" | "regression";

export function compareBaselineResult(input: { baselinePassed?: boolean; candidatePassed: boolean }): BaselineComparison {
  if (input.baselinePassed === undefined) return "not_run";
  if (!input.baselinePassed && !input.candidatePassed) return "preexisting_failure";
  if (input.baselinePassed && !input.candidatePassed) return "regression";
  return "baseline_passed";
}
