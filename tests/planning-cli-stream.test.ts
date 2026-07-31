import { describe, expect, it } from "vitest";

import { completeClaudePlanningStream, decodeClaudePlanningStreamLine, formatPlanningCliDiagnostics } from "@/lib/server/runs/v2/run-coordinator-host";

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

  /**
   * La celda N=16 de `retry-12-measure` perdió su medición acá: el planner salió
   * con código distinto de cero después de emitir 14.685 bytes, y el diagnóstico
   * conservó los tipos de envelope y el conteo de bytes pero no una sola palabra
   * de lo que el CLI dijo. Con stderr vacío, el fallo quedó inatribuible.
   */
  it("keeps what the CLI said, so a planner failure can be attributed", () => {
    const diagnostics = formatPlanningCliDiagnostics({
      observedEnvelopeTypes: ["assistant", "result", "system"],
      stdoutBytes: 14685,
      outputTail: "I cannot produce 16 modules without exceeding the response budget."
    });

    expect(diagnostics).toContain("stdoutBytes=14685");
    expect(diagnostics).toMatch(/output=.*exceeding the response budget/iu);
  });

  it("redacts a secret that reached the preserved output", () => {
    const diagnostics = formatPlanningCliDiagnostics({
      observedEnvelopeTypes: ["result"],
      stdoutBytes: 40,
      outputTail: "failed: api_key=sk-not-a-real-secret while planning"
    });

    expect(diagnostics).not.toContain("sk-not-a-real-secret");
    expect(diagnostics).toContain("[redacted]");
  });

  it("omits the output field when the CLI said nothing", () => {
    expect(formatPlanningCliDiagnostics({ observedEnvelopeTypes: ["system"], stdoutBytes: 0 }))
      .not.toContain("output=");
  });
});
