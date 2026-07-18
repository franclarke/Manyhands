import { describe, expect, it } from "vitest";
import { adaptCoordinatorEvent } from "@/lib/run-model/sse-adapter";

describe("canonical run-event adapter", () => {
  it("preserves the coordinator envelope without semantic translation", () => {
    const payload = {
      attemptId: "attempt-1",
      nodeId: "node-api",
      candidateCommit: "abc123",
      outputDigest: "sha256:candidate",
      changedFiles: ["src/api.ts"]
    };

    const event = adaptCoordinatorEvent({
      eventId: "event-7",
      runId: "run-v2",
      sequence: 7,
      occurredAt: "2026-07-17T12:00:00.000Z",
      type: "attempt.candidate_created",
      payload
    });

    expect(event).toEqual({
      eventId: "event-7",
      runId: "run-v2",
      seq: 7,
      at: "2026-07-17T12:00:00.000Z",
      actor: "system",
      type: "attempt.candidate_created",
      payload
    });
    expect(event.payload).not.toBe(payload);
  });
});
