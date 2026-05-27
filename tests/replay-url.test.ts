import { describe, expect, it } from "vitest";
import { buildReplayDemoUrl } from "@/lib/replay-url";

describe("buildReplayDemoUrl", () => {
  it("defaults benchmark/config when not supplied", () => {
    expect(
      buildReplayDemoUrl({ workspaceId: "ws-1", granularity: "alta", model: "claude-opus-4.7" })
    ).toBe(
      "/replay/demo?benchmark=conflict-v0&config=B4&workspace=ws-1&granularity=fine&model=claude-opus-4.7"
    );
  });

  it("omits model when undefined or empty", () => {
    expect(buildReplayDemoUrl({ workspaceId: "ws-1", granularity: "media" })).toBe(
      "/replay/demo?benchmark=conflict-v0&config=B4&workspace=ws-1&granularity=balanced"
    );
    expect(buildReplayDemoUrl({ workspaceId: "ws-1", granularity: "media", model: "" })).toBe(
      "/replay/demo?benchmark=conflict-v0&config=B4&workspace=ws-1&granularity=balanced"
    );
  });

  it("respects benchmark and config overrides", () => {
    expect(
      buildReplayDemoUrl({
        workspaceId: "ws-2",
        granularity: "baja",
        benchmark: "mock-v0",
        config: "B3"
      })
    ).toBe(
      "/replay/demo?benchmark=mock-v0&config=B3&workspace=ws-2&granularity=coarse"
    );
  });
});
