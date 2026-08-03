import { describe, expect, it } from "vitest";
import { buildCodexPlanningArgs, resolvePlanningStepTimeoutMs } from "@/lib/server/runs/v2/run-coordinator-host";

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

  it("can enforce a JSON response at the Codex CLI boundary", () => {
    expect(buildCodexPlanningArgs({ model: "gpt-5.4-mini", effort: "medium" }, "C:/schema.json")).toContain("--output-schema");
    expect(buildCodexPlanningArgs({ model: "gpt-5.4-mini", effort: "medium" }, "C:/schema.json")).toContain("C:/schema.json");
  });

  it("allows a slow but live Codex planning turn to finish before timing out", () => {
    expect(resolvePlanningStepTimeoutMs(undefined)).toBe(600_000);
    expect(resolvePlanningStepTimeoutMs("450000")).toBe(450_000);
    expect(resolvePlanningStepTimeoutMs("invalid")).toBe(600_000);
  });
});
