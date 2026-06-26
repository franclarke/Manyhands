import { describe, expect, it } from "vitest";
import type { AgentExecutionResult } from "@manyhands/execution-core";

import { validationOutputOf } from "./execution-nodes";

// Builds a minimal AgentExecutionResult; only the fields validationOutputOf
// reads matter, so the rest is cast away.
function res(over: Record<string, unknown>): AgentExecutionResult {
  return {
    taskId: "leaf-x",
    status: "validation_failed",
    stderrTail: "",
    stdoutTail: "",
    ...over
  } as unknown as AgentExecutionResult;
}

describe("validationOutputOf (O-10: the leaf gate / repair must never get a blank reason)", () => {
  it("returns validationResult.output when it is present and non-empty", () => {
    const out = validationOutputOf(res({ validationResult: { passed: false, output: "tests failed: 2/3", exitCode: 1 } }));
    expect(out).toBe("tests failed: 2/3");
  });

  it("falls through to stderrTail when validationResult.output is an EMPTY string", () => {
    // The bug: `output ?? stderrTail` keeps "" because ?? only falls through on
    // null/undefined, so the real error on stderr was shadowed by an empty stdout.
    const out = validationOutputOf(
      res({ validationResult: { passed: false, output: "", exitCode: 1 }, stderrTail: "ERR_MODULE_NOT_FOUND ./eventBus" })
    );
    expect(out).toContain("ERR_MODULE_NOT_FOUND");
  });

  it("falls through to stdoutTail when output and stderr are empty", () => {
    const out = validationOutputOf(res({ stderrTail: "", stdoutTail: "build failed at src/bus/eventBus.ts:3" }));
    expect(out).toContain("build failed");
  });

  it("synthesizes a non-empty, actionable reason naming the status when all output is empty (e.g. timeout)", () => {
    const out = validationOutputOf(res({ taskId: "event-bus-test", status: "timeout", stderrTail: "", stdoutTail: "" }));
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("timeout");
    expect(out).toContain("event-bus-test");
  });
});
