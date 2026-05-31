import { describe, expect, it } from "vitest";
import { buildStepPrompt } from "@manyhands/decomposer";

describe("recursive decomposer prompt", () => {
  it("biases sibling tasks toward parallel execution unless order is required", () => {
    const prompt = buildStepPrompt({
      title: "Build a task board",
      goal: "Create state, storage, and UI for a task board",
      aggressiveness: "medium",
      inheritedInterfaces: [],
      depthRemaining: 4
    });

    expect(prompt.system).toContain("Default `dependencies` to [] for siblings");
    expect(prompt.system).toContain("not execution dependencies");
    expect(prompt.system).toContain("normal parallel leaves");
  });
});
