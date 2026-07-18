import { describe, expect, it } from "vitest";

import { decodeClaudePlanningStreamLine } from "@/lib/server/runs/v2/run-coordinator-host";

describe("planning CLI stream", () => {
  it("extracts Claude text deltas without confusing other stream events with model output", () => {
    expect(decodeClaudePlanningStreamLine(JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "{\"type\":\"planning.node\"}\n" } }
    }))).toEqual({ textDelta: "{\"type\":\"planning.node\"}\n" });
    expect(decodeClaudePlanningStreamLine(JSON.stringify({
      type: "stream_event",
      event: { type: "message_start", message: {} }
    }))).toEqual({});
  });

  it("uses the final result as the complete planner response", () => {
    expect(decodeClaudePlanningStreamLine(JSON.stringify({ type: "result", result: "{\"schemaVersion\":2}" }))).toEqual({
      result: "{\"schemaVersion\":2}"
    });
  });
});
