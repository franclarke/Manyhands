import { describe, expect, it } from "vitest";

import { completeClaudePlanningStream, decodeClaudePlanningStreamLine } from "@/lib/server/runs/v2/run-coordinator-host";

describe("planning CLI stream", () => {
  it("extracts Claude text deltas without confusing other stream events with model output", () => {
    expect(decodeClaudePlanningStreamLine(JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "{\"type\":\"planning.node\"}\n" } }
    }))).toEqual({ envelopeType: "stream_event", textDelta: "{\"type\":\"planning.node\"}\n" });
    expect(decodeClaudePlanningStreamLine(JSON.stringify({
      type: "stream_event",
      event: { type: "message_start", message: {} }
    }))).toEqual({ envelopeType: "stream_event" });
  });

  it("supports public assistant messages while preserving their progressive planning nodes", () => {
    expect(decodeClaudePlanningStreamLine(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "{\"type\":\"planning.node\"}\n" },
          { type: "tool_use", id: "tool-1", name: "Read", input: {} }
        ]
      }
    }))).toEqual({
      envelopeType: "assistant",
      assistantText: "{\"type\":\"planning.node\"}\n"
    });
  });

  it("uses the final result as the complete planner response", () => {
    expect(decodeClaudePlanningStreamLine(JSON.stringify({ type: "result", result: "{\"schemaVersion\":2}" }))).toEqual({
      envelopeType: "result",
      result: "{\"schemaVersion\":2}"
    });
  });

  it("reports a terminal stream error and refuses a successful close without a final result", () => {
    expect(decodeClaudePlanningStreamLine(JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      is_error: true
    }))).toEqual({ envelopeType: "result", terminalError: "error_max_turns" });

    expect(() => completeClaudePlanningStream({
      observedEnvelopeTypes: ["assistant", "system"],
      stdoutBytes: 912
    })).toThrow(/without a successful terminal result.*assistant.*stdoutBytes=912/i);
  });
});
