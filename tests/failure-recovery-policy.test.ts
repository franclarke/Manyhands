import { describe, expect, it } from "vitest";
import { classifyFailure, eventsForCommand, recoveryPolicyFor } from "@manyhands/run-coordinator";

describe("failure recovery policy", () => {
  it.each([
    [{ source: "executor", code: "timeout", timedOut: true }, "executor_timeout", "switch_executor"],
    [{ source: "executor", code: "auth" }, "environment_auth_executor", "request_environment_fix"],
    [{ source: "validation", exitCode: 1 }, "code_test", "repair_code"],
    [{ source: "planning", code: "invalid_contract" }, "contract_decomposition", "propose_graph_amendment"],
    [{ source: "artifact", code: "undeclared_artifact" }, "undeclared_artifact", "propose_artifact_requirement"],
    [{ source: "scope", code: "scope_violation" }, "scope_unexpected_commit", "discard_candidate"],
    [{ source: "integration", code: "conflict" }, "integration", "repair_integration"],
    [{ source: "validation", code: "shared_config_broken" }, "shared_infrastructure", "raise_local_decision"],
    [{ source: "artifact", code: "artifact_empty" }, "upstream_artifact_unusable", "raise_local_decision"],
    [{ source: "executor", code: "workspace_ref_rejected" }, "environment_workspace", "raise_local_decision"]
  ] as const)("classifies %j as %s", (observation, expectedClass, expectedFirstAction) => {
    const failureClass = classifyFailure(observation);
    const policy = recoveryPolicyFor(failureClass);
    expect(failureClass).toBe(expectedClass);
    expect(policy.actions[0]).toBe(expectedFirstAction);
  });

  it("always discards a scope-violating candidate and never auto-adopts it", () => {
    const policy = recoveryPolicyFor(classifyFailure({ source: "scope", code: "scope_violation" }));
    expect(policy.discardCandidate).toBe(true);
    expect(policy.actions).not.toContain("adopt_candidate");
  });

  it.each(["upstream_artifact_unusable", "environment_workspace"] as const)("does not retry %s because retrying cannot change its cause", (failureClass) => {
    expect(recoveryPolicyFor(failureClass).automaticRetryBudget).toBe(0);
  });

  it("does not repeat an executor timeout with the same prompt, model, and deadline", () => {
    const policy = recoveryPolicyFor(classifyFailure({ source: "executor", code: "timeout", timedOut: true }));

    expect(policy.automaticRetryBudget).toBe(0);
    expect(policy.actions).not.toContain("retry_attempt");
    expect(policy.actions).toEqual(["switch_executor", "propose_graph_amendment", "raise_local_decision"]);
  });

  it("compiles classification and allowed recovery into one durable fact", () => {
    const [event] = eventsForCommand({} as never, {
      type: "record_failure",
      nodeId: "node-1",
      observation: { source: "artifact", code: "undeclared_artifact" }
    });
    expect(event).toEqual({
      type: "failure.classified",
      payload: expect.objectContaining({
        nodeId: "node-1",
        failureClass: "undeclared_artifact",
        allowedActions: ["propose_artifact_requirement"],
        discardCandidate: true
      })
    });
  });
});
