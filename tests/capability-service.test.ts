import { describe, expect, it } from "vitest";
import {
  assertAvailableSelection,
  assertDeclaredStageSelection,
  inspectCapabilities
} from "@/lib/server/providers/capability-service";
import { modelOptionsFromCapabilities } from "@/lib/models";
import type { ProviderReadiness } from "@/lib/api-types";

const readyCodex: ProviderReadiness = {
  executorId: "codex-cli",
  label: "Codex CLI",
  status: "ready",
  binaryPath: "codex",
  quota: "unknown",
  checks: [{ id: "cli", status: "pass", label: "Codex CLI", message: "Detected" }]
};

describe("CapabilityService", () => {
  it("validates capability and effort while injecting the declared default", () => {
    expect(assertDeclaredStageSelection(
      "Planning",
      { executorId: "codex-cli", model: "gpt-5.5" },
      "planning"
    )).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });

    expect(assertDeclaredStageSelection(
      "Planning",
      { executorId: "codex-cli", model: "gpt-5.4", effort: "high" },
      "planning"
    )).toEqual({ executorId: "codex-cli", model: "gpt-5.4", effort: "high" });
  });

  it("keeps declared and available as separate facts", async () => {
    const capabilities = await inspectCapabilities(null, {
      inspectReadiness: async () => [readyCodex]
    });
    const codex = capabilities.executors.find((entry) => entry.executorId === "codex-cli");
    expect(codex?.models.some((model) => model.id === "gpt-5.5")).toBe(true);
    expect(codex?.readiness.status).toBe("ready");
    expect(() => assertAvailableSelection(
      capabilities,
      { executorId: "codex-cli", model: "gpt-5.5" },
      "Planning"
    )).not.toThrow();
    expect(() => assertAvailableSelection(
      capabilities,
      { executorId: "claude-code-cli", model: "sonnet" },
      "Planning"
    )).toThrow("No se pudo verificar Claude Code CLI");
  });

  it("omits disabled executors from the model selector", async () => {
    const capabilities = await inspectCapabilities(null, {
      inspectReadiness: async () => [readyCodex]
    });

    const options = modelOptionsFromCapabilities(capabilities);

    expect(options.some((option) => option.executorId === "opencode-cli")).toBe(false);
    expect(options.some((option) => option.executorId === "claude-code-cli")).toBe(true);
  });
});
