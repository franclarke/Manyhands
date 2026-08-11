import { describe, expect, it } from "vitest";
import { recoveryPolicyFor } from "@manyhands/run-coordinator";
import { retryBudgetFor } from "@manyhands/orchestrator-graph";

/**
 * The declared recovery policy is the one that runs.
 *
 * `POLICIES` states, per failure class, how many automatic retries are worth
 * spending and why — one for `code_test`, because tests failing is the expected
 * outcome the repair loop exists for; zero for `environment_auth_executor`,
 * because repeating a call that was refused cannot make credentials appear. The
 * driver ignored all of it and hardcoded `failureClass === "transient"`, so a
 * leaf whose tests failed escalated to a human on its first attempt and no
 * composite ever retried at all. Every run stopped at the first ordinary
 * failure of an agent writing code.
 *
 * The run-level budget tunes how many retries a class that admits them gets. It
 * cannot resurrect a class the policy set to zero: those zeros are not a
 * quantity, they are the statement that repeating the same call is meaningless.
 */
describe("automatic retry budget", () => {
  it("honours the budget the policy declares for the class", () => {
    expect(retryBudgetFor(undefined, recoveryPolicyFor("code_test"))).toBe(1);
    expect(retryBudgetFor(undefined, recoveryPolicyFor("integration"))).toBe(1);
    expect(retryBudgetFor(undefined, recoveryPolicyFor("transient"))).toBe(2);
  });

  it("lets a run raise the budget of a class that admits retries", () => {
    expect(retryBudgetFor(3, recoveryPolicyFor("code_test"))).toBe(3);
    expect(retryBudgetFor(0, recoveryPolicyFor("code_test"))).toBe(0);
  });

  it("never retries a class whose policy says repeating the call is meaningless", () => {
    for (const failureClass of [
      "environment_auth_executor",
      "contract_decomposition",
      "undeclared_artifact",
      "scope_unexpected_commit",
      "environment_workspace"
    ] as const) {
      expect(retryBudgetFor(5, recoveryPolicyFor(failureClass)), failureClass).toBe(0);
    }
  });
});
