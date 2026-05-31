import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pickDecomposer } from "@/lib/decomposer-policy";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.MANYHANDS_FORCE_FALLBACK;
  delete process.env.MANYHANDS_DECOMPOSER;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("pickDecomposer", () => {
  it("falls back to deterministic when no API key is present", () => {
    const selection = pickDecomposer({
      userPrompt: "anything",
      model: "claude-test"
    });
    expect(selection.provider).toBe("deterministic");
    expect(selection.fallbackReason).toBe("no_api_key");
  });

  it("falls back when MANYHANDS_FORCE_FALLBACK=1", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.MANYHANDS_FORCE_FALLBACK = "1";
    const selection = pickDecomposer({
      userPrompt: "anything",
      model: "claude-test"
    });
    expect(selection.provider).toBe("deterministic");
    expect(selection.fallbackReason).toBe("forced_by_env");
  });

  it("honours forceFallback from the caller", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const selection = pickDecomposer({
      userPrompt: "anything",
      model: "claude-test",
      forceFallback: true
    });
    expect(selection.provider).toBe("deterministic");
    expect(selection.fallbackReason).toBe("forced_by_caller");
  });

  it("selects the recursive decomposer by default when an API key is present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const selection = pickDecomposer({
      userPrompt: "anything",
      model: "claude-test"
    });
    expect(selection.provider).toBe("anthropic");
    expect(selection.promptTemplateVersion).toContain("recursive-decomposer");
    // Recursive path does not expose single-shot telemetry.
    expect(selection.getAnthropicTelemetry).toBeUndefined();
  });

  it("selects the single-pass baseline when MANYHANDS_DECOMPOSER=single-pass", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.MANYHANDS_DECOMPOSER = "single-pass";
    const selection = pickDecomposer({
      userPrompt: "anything",
      model: "claude-test"
    });
    expect(selection.provider).toBe("anthropic");
    expect(selection.promptTemplateVersion).toContain("decomposer-prompt");
    expect(selection.getAnthropicTelemetry).toBeDefined();
  });
});
