import { describe, expect, it } from "vitest";
import { classifyFailure } from "@manyhands/run-coordinator";
import { leafFailureObservation } from "@manyhands/orchestrator-graph";

/**
 * DECISIONS.md A11: failures recover by cause, not by a universal retry count.
 * The V2 node executor already knows WHY a leaf failed (scope violation,
 * unexpected commit, executor crash), so the driver must carry that cause into
 * the failure observation instead of labelling everything `execution_failed`.
 *
 * Observed in a canonical run: three leaves were rejected by the ScopeChecker,
 * but the classifier saw `execution_failed` and chose `code_test` recovery
 * (repair the code) instead of `scope_unexpected_commit` (discard the
 * candidate) — the wrong strategy for the actual cause.
 */
describe("leafFailureObservation", () => {
  it("preserves a scope violation as a scope-sourced cause", () => {
    const observation = leafFailureObservation({ reason: "scope_violation: touched tests/expense.test.ts" });

    expect(observation.source).toBe("scope");
    expect(observation.code).toBe("scope_violation");
    expect(classifyFailure(observation)).toBe("scope_unexpected_commit");
  });

  it("preserves an unexpected agent commit as a scope-sourced cause", () => {
    const observation = leafFailureObservation({ reason: "unexpected_commit: the agent committed on its own" });

    expect(observation.code).toBe("unexpected_commit");
    expect(classifyFailure(observation)).toBe("scope_unexpected_commit");
  });

  it("falls back to a generic executor failure when the cause is not encoded", () => {
    const observation = leafFailureObservation({ reason: "the CLI crashed while writing the patch" });

    expect(observation.source).toBe("executor");
    expect(observation.code).toBe("execution_failed");
    expect(classifyFailure(observation)).toBe("code_test");
  });

  it("keeps the full reason as the message so evidence is not lost", () => {
    const reason = "scope_violation: touched tests/expense.test.ts";

    expect(leafFailureObservation({ reason }).message).toBe(reason);
  });
});

describe("scope violation reasons name the offending paths", () => {
  it("carries the violated paths through to the classified failure", async () => {
    const { executionFailureReasonForTest } = await import("@manyhands/execution-core");
    const reason = executionFailureReasonForTest({
      status: "scope_violation",
      scopeCheck: { violations: ["src/forbidden.ts", "config/global.json"] },
      // The diff used to be what surfaced in the reason; it must not win.
      stdoutTail: "+ some enormous diff hunk that hides the real cause"
    });

    expect(reason).toContain("src/forbidden.ts");
    expect(reason).toContain("config/global.json");
    expect(reason).not.toContain("diff hunk");
    expect(leafFailureObservation({ reason }).code).toBe("scope_violation");
  });
});
