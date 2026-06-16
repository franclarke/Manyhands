import type { TraceEvent } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import { runModelEventsFromTrace } from "@/lib/server/runs/run-model-trace-adapter";

const AT = "2026-06-07T12:00:00.000Z";
const CONTEXT = { runId: "run-1", defaultModel: "gemini-2.5-pro" };

function trace(event: Omit<TraceEvent, "id" | "timestamp" | "actor">): TraceEvent {
  return {
    id: "trace-1",
    timestamp: AT,
    actor: "system",
    ...event
  };
}

describe("run-model trace adapter", () => {
  it("maps execution batches to planned/opened/closed waves", () => {
    const opened = runModelEventsFromTrace(
      trace({
        type: "batch_started",
        payload: { batchId: "batch-2", taskIds: ["a", "b"] }
      }),
      CONTEXT
    );

    expect(opened.map((event) => event.type)).toEqual(["wave.planned", "wave.opened"]);
    expect(opened[0]?.payload).toMatchObject({
      waves: [{ waveId: "batch-2", index: 1, nodeIds: ["a", "b"], unlockedBySeams: [] }]
    });
    expect(opened[1]?.payload).toMatchObject({ waveId: "batch-2", nodeIds: ["a", "b"] });

    const closed = runModelEventsFromTrace(
      trace({
        type: "batch_completed",
        payload: { batchId: "batch-2" }
      }),
      CONTEXT
    );
    expect(closed).toEqual([{ actor: "system", at: AT, type: "wave.closed", payload: { waveId: "batch-2" } }]);
  });

  it("maps executor and validation telemetry to node verify iterations", () => {
    const started = runModelEventsFromTrace(
      trace({
        type: "executor_started",
        taskId: "leaf-a",
        payload: { executorId: "claude-code-cli", model: "sonnet" }
      }),
      CONTEXT
    );
    expect(started[0]?.type).toBe("node.execution.started");
    expect(started[0]?.payload).toMatchObject({
      nodeId: "leaf-a",
      agent: "claude-code-cli",
      model: "sonnet"
    });

    const executorFailed = runModelEventsFromTrace(
      trace({
        type: "executor_completed",
        taskId: "leaf-a",
        payload: { exitCode: 1, timedOut: false }
      }),
      CONTEXT
    );
    expect(executorFailed[0]?.type).toBe("node.verify.iteration");
    expect(executorFailed[0]?.payload).toMatchObject({
      nodeId: "leaf-a",
      build: "fail",
      testsPass: 0,
      testsTotal: 1
    });

    const validationStarted = runModelEventsFromTrace(
      trace({
        type: "validation_started",
        taskId: "leaf-a",
        payload: { scope: "leaf", commandCount: 3 }
      }),
      CONTEXT
    );
    expect(validationStarted[0]?.payload).toMatchObject({
      nodeId: "leaf-a",
      build: "pass",
      testsPass: 0,
      testsTotal: 3
    });
  });

  it("maps executor stdout/stderr chunks to native node console output events", () => {
    const mapped = runModelEventsFromTrace(
      trace({
        type: "executor_output",
        taskId: "leaf-a",
        payload: { stream: "stderr", chunk: "visible warning\n" }
      }),
      CONTEXT
    );

    expect(mapped).toEqual([
      {
        actor: "agent",
        at: AT,
        type: "node.cli.output",
        payload: { nodeId: "leaf-a", stream: "stderr", chunk: "visible warning\n" }
      }
    ]);
  });

  it("maps cherry-pick conflicts to typed conflict events with diagnosis refs", () => {
    const mapped = runModelEventsFromTrace(
      trace({
        type: "cherry_pick_conflict",
        taskId: "root",
        payload: { childTaskId: "leaf-a", files: ["src/shared.ts"] }
      }),
      CONTEXT
    );

    expect(mapped[0]?.type).toBe("conflict.detected");
    expect(mapped[0]?.payload).toMatchObject({
      conflictId: "integration:root:conflict",
      dimension: "textual",
      nodeIds: ["root", "leaf-a"],
      files: ["src/shared.ts"],
      autoResolvable: true,
      diagnosisRef: "diagnosis://runs/run-1/integration/root"
    });
  });
});
