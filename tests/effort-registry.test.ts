import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_EXECUTOR_ID,
  CODEX_EXECUTOR_ID,
  EFFORT_LEVELS,
  EXECUTOR_DESCRIPTORS,
  collectExecutorRegistryErrors,
  defaultEffortForSelection,
  effortsForSelection,
  getExecutorDescriptor,
  isEffortLevel,
  supportsEffortForSelection,
  type EffortLevel,
  type ExecutorDescriptor
} from "@manyhands/shared";
import { DEFAULT_TIER_ROUTES } from "@manyhands/execution-core";

describe("canonical EffortLevel", () => {
  it("declares the four reasoning-effort levels in order", () => {
    expect(EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("guards effort strings with isEffortLevel", () => {
    expect(isEffortLevel("xhigh")).toBe(true);
    expect(isEffortLevel("medium")).toBe(true);
    expect(isEffortLevel("extreme")).toBe(false);
    expect(isEffortLevel(undefined)).toBe(false);
  });
});

describe("registry effort declarations", () => {
  it("declares Codex models with all four efforts and a medium default", () => {
    const codex = getExecutorDescriptor(CODEX_EXECUTOR_ID);
    for (const model of codex.models) {
      expect(model.efforts, `${model.id} efforts`).toEqual(["low", "medium", "high", "xhigh"]);
      expect(model.defaultEffort, `${model.id} defaultEffort`).toBe("medium");
    }
  });

  it("declares Claude models with no effort knob", () => {
    const claude = getExecutorDescriptor(CLAUDE_CODE_EXECUTOR_ID);
    for (const model of claude.models) {
      expect(model.efforts, `${model.id} efforts`).toBeNull();
      expect(model.defaultEffort, `${model.id} defaultEffort`).toBeUndefined();
    }
  });

  it("resolves effort support, levels and default from a selection", () => {
    expect(supportsEffortForSelection({ executorId: CODEX_EXECUTOR_ID, model: "gpt-5.5" })).toBe(true);
    expect(effortsForSelection({ executorId: CODEX_EXECUTOR_ID, model: "gpt-5.5" })).toContain("xhigh");
    expect(defaultEffortForSelection({ executorId: CODEX_EXECUTOR_ID, model: "gpt-5.5" })).toBe("medium");

    expect(supportsEffortForSelection({ executorId: CLAUDE_CODE_EXECUTOR_ID, model: "sonnet" })).toBe(false);
    expect(effortsForSelection({ executorId: CLAUDE_CODE_EXECUTOR_ID, model: "sonnet" })).toBeNull();
    expect(defaultEffortForSelection({ executorId: CLAUDE_CODE_EXECUTOR_ID, model: "sonnet" })).toBeUndefined();
  });
});

describe("registry static validation", () => {
  it("accepts the canonical registry", () => {
    expect(collectExecutorRegistryErrors(EXECUTOR_DESCRIPTORS)).toEqual([]);
  });

  const base = (): ExecutorDescriptor => ({
    id: CLAUDE_CODE_EXECUTOR_ID,
    label: "X",
    provider: "P",
    binaryEnvVar: "MH_X",
    defaultBinary: "x",
    enabled: true,
    capabilities: ["planning", "execution", "repair"],
    usageSource: "reported",
    defaultModel: "a",
    models: [{ id: "a", label: "A", capabilities: ["execution"], usageSource: "reported", efforts: null }]
  });

  it("rejects a defaultEffort that is not in efforts", () => {
    const d = base();
    d.models[0]!.efforts = ["low", "medium"];
    d.models[0]!.defaultEffort = "xhigh";
    expect(collectExecutorRegistryErrors([d]).join("\n")).toMatch(/defaultEffort/i);
  });

  it("rejects a defaultEffort on a model without efforts", () => {
    const d = base();
    d.models[0]!.efforts = null;
    d.models[0]!.defaultEffort = "medium";
    expect(collectExecutorRegistryErrors([d]).join("\n")).toMatch(/without efforts/i);
  });

  it("rejects an empty efforts array (must be null when unsupported)", () => {
    const d = base();
    d.models[0]!.efforts = [];
    expect(collectExecutorRegistryErrors([d]).join("\n")).toMatch(/empty|null/i);
  });

  it("rejects duplicate model ids inside one executor", () => {
    const d = base();
    d.models.push({ id: "a", label: "dup", capabilities: ["execution"], usageSource: "reported", efforts: null });
    expect(collectExecutorRegistryErrors([d]).join("\n")).toMatch(/duplicate/i);
  });

  it("rejects a defaultModel not present in the model list", () => {
    const d = base();
    d.defaultModel = "missing";
    expect(collectExecutorRegistryErrors([d]).join("\n")).toMatch(/defaultModel/i);
  });

  it("rejects an unknown capability", () => {
    const d = base();
    d.models[0]!.capabilities = ["planning", "teleport" as never];
    expect(collectExecutorRegistryErrors([d]).join("\n")).toMatch(/capability/i);
  });

  it("rejects an effort outside the canonical set", () => {
    const d = base();
    d.models[0]!.efforts = ["low", "insane" as EffortLevel];
    expect(collectExecutorRegistryErrors([d]).join("\n")).toMatch(/effort/i);
  });
});

describe("legacy complexity-routing lanes", () => {
  it("contains only executor/model pairs declared by the canonical registry", () => {
    const registered = new Set(
      EXECUTOR_DESCRIPTORS.flatMap((d) => d.models.map((m) => `${d.id}/${m.id}`))
    );
    const laneModels = new Set(
      Object.values(DEFAULT_TIER_ROUTES)
        .flat()
        .map((selection) => `${selection.executorId}/${selection.model}`)
    );
    const unregistered = [...laneModels].filter((key) => !registered.has(key)).sort();
    expect(unregistered).toEqual([]);
  });
});
