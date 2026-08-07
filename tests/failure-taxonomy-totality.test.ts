import { describe, expect, it } from "vitest";

import {
  FailureClassSchema,
  classifyFailure,
  recoveryPolicyFor,
  type FailureObservation
} from "@manyhands/run-coordinator";

/**
 * Stage 5 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`:
 * "every failure maps to exactly one cause with a defined recovery, and no
 * cause lands in a generic bucket".
 *
 * The taxonomy was already closed. What was not total was the classifier: it
 * ended in `return "code_test"`, so anything unrecognised was attributed to the
 * agent's code. For an executor that failed in an unmodelled way that is not a
 * default, it is a wrong claim — and one that would quietly corrupt the failure
 * statistics the thesis reports.
 */

const observation = (overrides: Partial<FailureObservation> = {}): FailureObservation => ({
  source: "executor",
  ...overrides
});

describe("failure taxonomy", () => {
  it("gives every class a recovery policy", () => {
    for (const failureClass of FailureClassSchema.options) {
      const policy = recoveryPolicyFor(failureClass);
      expect(policy.actions.length, `${failureClass} has no recovery action`).toBeGreaterThan(0);
      expect(policy.failureClass).toBe(failureClass);
    }
  });

  it("still attributes the causes it can actually infer", () => {
    expect(classifyFailure(observation({ source: "validation", code: "test_failed" }))).toBe("code_test");
    expect(classifyFailure(observation({ timedOut: true }))).toBe("transient");
    expect(classifyFailure(observation({ code: "auth" }))).toBe("environment_auth_executor");
    expect(classifyFailure(observation({ source: "integration" }))).toBe("integration");
    expect(classifyFailure(observation({ source: "scope" }))).toBe("scope_unexpected_commit");
    expect(classifyFailure(observation({ source: "planning" }))).toBe("contract_decomposition");
  });

  /**
   * The case the stage forbids. An executor that died with an unmodelled code
   * says nothing about the agent's code, and calling it `code_test` sends the
   * run into `repair_code` — burning an attempt repairing something that was
   * never broken.
   */
  it("refuses to blame the code for an executor failure it cannot classify", () => {
    expect(classifyFailure(observation({ code: "hal_9000_refused", exitCode: 42 }))).toBe("unclassified");
  });

  /**
   * One retry, then a human. Repairing code is off the table because nobody
   * established the code was wrong, but a single retry is evidence gathering
   * rather than blind hope: a failure that reproduces is persistent, one that
   * does not was transient. Refusing to retry at all would stop a hands-off run
   * on every unmodelled CLI crash, which is the most common failure there is.
   */
  it("names an unclassified failure and recovers without claiming a cause", () => {
    const policy = recoveryPolicyFor("unclassified");

    expect(policy.actions).toEqual(["retry_attempt", "raise_local_decision"]);
    expect(policy.actions).not.toContain("repair_code");
    expect(policy.automaticRetryBudget).toBe(1);
  });

  /**
   * Totality over the observation space rather than over a list of examples:
   * every source, with and without a code, has to land somewhere deliberate.
   */
  it("classifies every source the domain admits", () => {
    const sources = ["executor", "validation", "planning", "artifact", "scope", "integration"] as const;
    for (const source of sources) {
      const withoutCode = classifyFailure({ source });
      expect(FailureClassSchema.options, `${source} produced an unknown class`).toContain(withoutCode);
      const withUnknownCode = classifyFailure({ source, code: "totally_unmodelled" });
      expect(FailureClassSchema.options, `${source} produced an unknown class`).toContain(withUnknownCode);
    }
  });
});
