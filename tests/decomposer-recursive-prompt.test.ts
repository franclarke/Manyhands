import { describe, expect, it } from "vitest";
import { buildStepPrompt } from "@manyhands/decomposer";

describe("recursive decomposer prompt", () => {
  it("biases sibling tasks toward parallel execution unless order is required", () => {
    const prompt = buildStepPrompt({
      title: "Build a task board",
      goal: "Create state, storage, and UI for a task board",
      aggressiveness: "medium",
      inheritedInterfaces: [],
      atDepthLimit: false
    });

    expect(prompt.system).toContain("Default `dependencies` to [] for siblings");
    expect(prompt.system).toContain("not execution dependencies");
    expect(prompt.system).toContain("normal parallel leaves");
  });

  it("treats granularity as aggressiveness, never exposing a target depth or node count", () => {
    const prompt = buildStepPrompt({
      title: "Build a task board",
      goal: "Create state, storage, and UI for a task board",
      aggressiveness: "high",
      inheritedInterfaces: [],
      atDepthLimit: false
    });

    // No depth/count planning signal leaks to the model.
    expect(prompt.user).not.toContain("recursion levels remaining");
    expect(prompt.user).not.toMatch(/node count target/i);
    // Aggressiveness + local, asymmetric decision are communicated instead.
    expect(prompt.user).toContain("Decide locally");
    expect(prompt.system).toContain("never a target depth or node count");
  });

  it("only instructs a safety-stop atomic when the recursion rail is reached", () => {
    const normal = buildStepPrompt({
      title: "x",
      goal: "y",
      aggressiveness: "medium",
      inheritedInterfaces: [],
      atDepthLimit: false
    });
    expect(normal.user).not.toContain("safety limit");

    const atLimit = buildStepPrompt({
      title: "x",
      goal: "y",
      aggressiveness: "medium",
      inheritedInterfaces: [],
      atDepthLimit: true
    });
    expect(atLimit.user).toContain("safety limit");
  });
});
