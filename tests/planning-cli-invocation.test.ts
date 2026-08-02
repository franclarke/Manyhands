import { describe, expect, it } from "vitest";
import { buildCodexPlanningArgs } from "@/lib/server/runs/v2/run-coordinator-host";

describe("planning Codex CLI invocation", () => {
  it("starts every planning attempt in an ephemeral session", () => {
    expect(buildCodexPlanningArgs({ model: "gpt-5.4-mini", effort: "low" })).toEqual([
      "exec",
      "--model",
      "gpt-5.4-mini",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "-c",
      'model_reasoning_effort="low"',
      "-"
    ]);
  });
});
