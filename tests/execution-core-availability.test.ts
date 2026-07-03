import { describe, expect, it } from "vitest";
import { probeExecutorAvailability } from "@manyhands/execution-core";

describe("probeExecutorAvailability", () => {
  it("returns only enabled executors whose binary resolves", async () => {
    const available = await probeExecutorAvailability({
      commandExists: async (binary) => binary === "claude"
    });

    expect(available.has("claude-code-cli")).toBe(true);
    expect(available.has("codex-cli")).toBe(false);
    // opencode is disabled in the registry and must never be probed in.
    expect(available.has("opencode-cli")).toBe(false);
  });

  it("never throws when a probe fails — the executor is just unavailable", async () => {
    const available = await probeExecutorAvailability({
      commandExists: async () => {
        throw new Error("probe exploded");
      }
    });

    expect(available.size).toBe(0);
  });
});
