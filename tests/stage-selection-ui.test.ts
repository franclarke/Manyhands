import { describe, expect, it } from "vitest";
import { MODEL_OPTIONS, stageSelectionForSubmit } from "@/lib/models";

const codex = MODEL_OPTIONS.find((m) => m.id === "gpt-5.5")!;
const claude = MODEL_OPTIONS.find((m) => m.id === "sonnet")!;

describe("stageSelectionForSubmit — UI sends independent per-stage effort", () => {
  it("attaches the chosen effort for an effort-capable model", () => {
    expect(
      stageSelectionForSubmit({ executorId: "codex-cli", model: "gpt-5.5" }, codex, "xhigh")
    ).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "xhigh" });
  });

  it("omits effort for a model that declares none (Claude)", () => {
    expect(
      stageSelectionForSubmit({ executorId: "claude-code-cli", model: "sonnet" }, claude, "high")
    ).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
  });

  it("lets planning and execution carry different efforts", () => {
    const planning = stageSelectionForSubmit({ executorId: "codex-cli", model: "gpt-5.5" }, codex, "high");
    const execution = stageSelectionForSubmit({ executorId: "codex-cli", model: "gpt-5.5" }, codex, "low");
    expect(planning.effort).toBe("high");
    expect(execution.effort).toBe("low");
  });

  it("drops a stale effort that is not among the model's declared levels", () => {
    const narrow = { ...codex, efforts: ["low", "medium"] as const };
    expect(stageSelectionForSubmit({ executorId: "codex-cli", model: "gpt-5.5" }, narrow, "xhigh")).toEqual({
      executorId: "codex-cli",
      model: "gpt-5.5"
    });
  });
});
