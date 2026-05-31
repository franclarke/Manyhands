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
  it("selects Codex recursive by default without API keys", () => {
    const selection = pickDecomposer({
      userPrompt: "anything",
      model: "gpt-5",
      workspace: { id: "ws", slug: "ws", name: "WS", repoPath: "C:/repo", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    });
    expect(selection.provider).toBe("codex");
    expect(selection.model).toBe("gpt-5");
    expect(selection.promptTemplateVersion).toContain("recursive-decomposer");
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

  it("keeps Anthropic recursive as an explicit baseline", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.MANYHANDS_DECOMPOSER = "anthropic-recursive";
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
