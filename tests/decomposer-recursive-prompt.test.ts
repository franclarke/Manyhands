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

  it("tells child planning not to redeclare inherited interfaces", () => {
    const prompt = buildStepPrompt({
      title: "Build the UI workflow",
      goal: "Implement UI against the existing domain contract",
      aggressiveness: "medium",
      inheritedInterfaces: [
        {
          id: "HabitDomainApi",
          kind: "module",
          signature: "export function createHabit(name: string): Habit;",
          description: "Pure habit domain functions already defined by an ancestor."
        }
      ],
      atDepthLimit: false
    });

    expect(prompt.user).toContain("HabitDomainApi");
    expect(prompt.system).toContain("Do not redeclare an interface that is already in scope");
    expect(prompt.system).toContain("list that existing id in the child's `produces`");
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

  it("instructs leaf validation as commands instead of verification-only child agents", () => {
    const prompt = buildStepPrompt({
      title: "Build a task board",
      goal: "Create state, storage, and UI for a task board",
      aggressiveness: "medium",
      inheritedInterfaces: [],
      atDepthLimit: false
    });

    expect(prompt.system).toContain("leafValidationCommands");
    expect(prompt.system).toContain("NO crees nodos cuyo único propósito sea correr tests/typecheck/build/lint");
    expect(prompt.system).toContain("Crear una hoja solo cuando produce o modifica código fuente/tests");
    expect(prompt.system).toContain("parentValidationCommands");
  });
});
