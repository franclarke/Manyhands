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

  /**
   * A CLI that crashed says nothing about the agent's code. This used to
   * classify as `code_test`, which sent the run into `repair_code` — burning an
   * attempt repairing something never shown to be broken, and recording a cause
   * that was never observed. It is now named as what it is.
   */
  it("names an unencoded executor failure rather than blaming the code", () => {
    const observation = leafFailureObservation({ reason: "the CLI crashed while writing the patch" });

    expect(observation.source).toBe("executor");
    expect(observation.code).toBe("execution_failed");
    expect(classifyFailure(observation)).toBe("unclassified");
  });

  it("names the observed empty upstream artifact instead of leaving its consumer unclassified", () => {
    const observation = leafFailureObservation({
      reason: "Could not materialize artifact artifact-domain-output: artifact_empty."
    });

    expect(classifyFailure(observation)).toBe("upstream_artifact_unusable");
  });

  it("names the observed workspace ref failure instead of leaving it unclassified", () => {
    const observation = leafFailureObservation({
      reason: "update_ref failed for ref 'refs/manyhands/runs/run-1/attempts/run-1_attempt_node-a-hash/candidate': cannot lock ref: unable to create directory"
    });

    expect(classifyFailure(observation)).toBe("environment_workspace");
  });

  it("keeps an unavailable worktree pool in infrastructure recovery", () => {
    const observation = leafFailureObservation({
      reason: "worktree_pool_unavailable: could not remove invalid slot slot-000"
    });

    expect(observation.code).toBe("worktree_pool_unavailable");
    expect(classifyFailure(observation)).toBe("shared_infrastructure");
  });

  it("recognizes provider auth and binary causes when they are embedded in a repair reason", () => {
    expect(classifyFailure(leafFailureObservation({ reason: "Code repair failed: auth: expired login" }))).toBe("environment_auth_executor");
    expect(classifyFailure(leafFailureObservation({ reason: "executor_error: binary_missing: CLI not found" }))).toBe("environment_auth_executor");
  });

  it("fails closed when the declared sandbox capability is unavailable", () => {
    const observation = leafFailureObservation({
      reason: "SANDBOX_UNAVAILABLE: profile workspace requires capabilities unavailable from workspace provider."
    });

    expect(observation).toMatchObject({ source: "executor", code: "sandbox_unavailable" });
    expect(classifyFailure(observation)).toBe("environment_auth_executor");
  });

  it("fails closed when the executor reports a runtime sandbox mismatch", async () => {
    const { executionFailureReasonForTest } = await import("@manyhands/execution-core");
    const reason = executionFailureReasonForTest({
      status: "executor_error",
      failureKind: "sandbox_unavailable",
      failureHint: "Codex started read-only, but ManyHands required workspace-write."
    });

    const observation = leafFailureObservation({ reason });

    expect(observation).toMatchObject({ source: "executor", code: "sandbox_unavailable" });
    expect(classifyFailure(observation)).toBe("environment_auth_executor");
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

describe("timeout reasons stay actionable", () => {
  it("keeps executor output in traces instead of embedding a diff in the decision", async () => {
    const { executionFailureReasonForTest } = await import("@manyhands/execution-core");
    const reason = executionFailureReasonForTest({
      status: "timeout",
      failureKind: "timeout",
      failureHint: "The agent hit the hard timeout.",
      stdoutTail: "+ an enormous partial diff that belongs in diagnostics"
    });

    expect(reason).toBe("timeout: timeout: The agent hit the hard timeout.");
    expect(reason).not.toContain("partial diff");
  });
});
