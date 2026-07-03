import { describe, expect, it } from "vitest";
import { classifyExecutorFailure, type ExecutorRunOutcome } from "@manyhands/execution-core";

function outcome(partial: Partial<ExecutorRunOutcome>): ExecutorRunOutcome {
  return {
    exitCode: 1,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 10,
    ...partial
  };
}

describe("classifyExecutorFailure", () => {
  it("returns undefined for a clean exit", () => {
    expect(classifyExecutorFailure(outcome({ exitCode: 0 }))).toBeUndefined();
  });

  it("classifies timeouts", () => {
    const diagnosis = classifyExecutorFailure(outcome({ exitCode: 124, timedOut: true }));
    expect(diagnosis?.kind).toBe("timeout");
    expect(diagnosis?.hint.length).toBeGreaterThan(0);
  });

  it("classifies orchestrator aborts", () => {
    const diagnosis = classifyExecutorFailure(
      outcome({ exitCode: 130, stderr: "aborted by orchestrator" })
    );
    expect(diagnosis?.kind).toBe("aborted");
  });

  it("classifies a missing binary (spawn ENOENT)", () => {
    const diagnosis = classifyExecutorFailure(
      outcome({ exitCode: 127, stderr: "spawn codex ENOENT" })
    );
    expect(diagnosis?.kind).toBe("binary_missing");
    expect(diagnosis?.hint).toMatch(/PATH|_BIN/);
  });

  it("classifies authentication failures", () => {
    const diagnosis = classifyExecutorFailure(
      outcome({ stderr: "Error: 401 Unauthorized — invalid API key. Please run `gemini login`." })
    );
    expect(diagnosis?.kind).toBe("auth");
  });

  it("classifies quota and rate-limit failures", () => {
    const quota = classifyExecutorFailure(
      outcome({ stderr: "429 RESOURCE_EXHAUSTED: Quota exceeded for model" })
    );
    expect(quota?.kind).toBe("quota");

    const rate = classifyExecutorFailure(outcome({ stderr: "Rate limit reached, retry later" }));
    expect(rate?.kind).toBe("quota");
  });

  it("classifies unknown-model failures", () => {
    const diagnosis = classifyExecutorFailure(
      outcome({ stderr: "Error: model 'gemini-9.9-ultra' not found" })
    );
    expect(diagnosis?.kind).toBe("model_not_found");
  });

  it("falls back to unknown for unrecognized failures", () => {
    const diagnosis = classifyExecutorFailure(outcome({ stderr: "segfault in flux capacitor" }));
    expect(diagnosis?.kind).toBe("unknown");
  });

  it("prefers timeout over pattern matches in accumulated output", () => {
    const diagnosis = classifyExecutorFailure(
      outcome({ exitCode: 124, timedOut: true, stderr: "429 rate limit" })
    );
    expect(diagnosis?.kind).toBe("timeout");
  });
});
