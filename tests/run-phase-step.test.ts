import { describe, expect, it } from "vitest";
import { runPhaseStepIndex, RUN_PHASE_STEPS } from "@/lib/run-phase";

describe("runPhaseStepIndex", () => {
  it("maps planning statuses to the first steps", () => {
    expect(runPhaseStepIndex("created")).toBe(0);
    expect(runPhaseStepIndex("generating")).toBe(0);
    expect(runPhaseStepIndex("needs_review")).toBe(1);
  });

  it("maps approved/running to 'Execute agents'", () => {
    expect(RUN_PHASE_STEPS[runPhaseStepIndex("approved")]).toBe("Execute agents");
    expect(RUN_PHASE_STEPS[runPhaseStepIndex("running")]).toBe("Execute agents");
  });

  it("maps completed to 'Integrate'", () => {
    expect(RUN_PHASE_STEPS[runPhaseStepIndex("completed")]).toBe("Integrate");
  });

  it("marks an execution failure at 'Execute agents', not 'Review outputs'", () => {
    expect(RUN_PHASE_STEPS[runPhaseStepIndex("failed", "execution")]).toBe("Execute agents");
  });

  it("marks a planning failure at 'Plan generated'", () => {
    expect(RUN_PHASE_STEPS[runPhaseStepIndex("failed", "planning")]).toBe("Plan generated");
  });

  it("falls back to 'Review outputs' for a failure with unknown phase", () => {
    expect(RUN_PHASE_STEPS[runPhaseStepIndex("failed")]).toBe("Review outputs");
  });
});
