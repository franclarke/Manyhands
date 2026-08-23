import { describe, expect, it } from "vitest";

import {
  nodeRecoveryPresentation,
  nodeRuntimePresentation
} from "@/lib/run-model/node-live-presentation";
import type { RunEvent } from "@/lib/run-model/types";

describe("recoverable node failures", () => {
  it("presents a classified retryable failure as queued repair, not a terminal node", () => {
    const recovery = nodeRecoveryPresentation({
      nodeId: "packing",
      nodeStatus: "failed",
      runLifecycle: "running",
      events: [
        event(1, "attempt.failed", { attemptId: "attempt-1", nodeId: "packing", reason: "Tests failed" }),
        event(2, "failure.classified", {
          attemptId: "attempt-1",
          nodeId: "packing",
          failureClass: "code_test",
          allowedActions: ["repair_code"],
          automaticRetryBudget: 1
        })
      ]
    });

    expect(recovery).toEqual({
      phase: "queued",
      label: "Preparando reparación",
      detail: "El fallo es recuperable. El Run conserva el trabajo válido y prepara un nuevo intento."
    });
  });

  it("presents a retry attempt as repair in progress until it produces a result", () => {
    const recovery = nodeRecoveryPresentation({
      nodeId: "packing",
      nodeStatus: "running",
      runLifecycle: "running",
      events: [
        event(1, "attempt.failed", { attemptId: "attempt-1", nodeId: "packing", reason: "Tests failed" }),
        event(2, "failure.classified", {
          attemptId: "attempt-1",
          nodeId: "packing",
          failureClass: "code_test",
          allowedActions: ["repair_code"],
          automaticRetryBudget: 1
        }),
        event(3, "attempt.started", {
          attemptId: "attempt-2",
          retryOfAttemptId: "attempt-1",
          nodeId: "packing"
        })
      ]
    });

    expect(recovery?.phase).toBe("repairing");
    expect(recovery?.label).toBe("Reparando");
    expect(nodeRuntimePresentation("running", recovery)).toEqual({
      state: "repairing",
      label: "Reparando",
      detail: "Un nuevo intento está corrigiendo el fallo. El resto del Run puede seguir avanzando."
    });
  });

  it("presents an authorized retry as queued repair before the replacement attempt is published", () => {
    const recovery = nodeRecoveryPresentation({
      nodeId: "dashboard",
      nodeStatus: "failed",
      runLifecycle: "waiting_for_input",
      events: [
        event(1, "attempt.failed", { attemptId: "attempt-1", nodeId: "dashboard", reason: "Timeout" }),
        event(2, "decision.raised", {
          decision: {
            id: "retry-dashboard",
            affectedNodeIds: ["dashboard"],
            repairTargetNodeId: "dashboard",
            options: [{ id: "retry", label: "Reintentar" }]
          }
        }),
        event(3, "decision.resolved", {
          decisionId: "retry-dashboard",
          optionId: "retry"
        })
      ]
    });

    expect(recovery).toEqual({
      phase: "queued",
      label: "Preparando reparación",
      detail: "La reparación fue autorizada. El Run conserva el trabajo válido y prepara el nuevo intento."
    });
  });

  it("keeps an exhausted or terminal failure visibly terminal", () => {
    const exhausted = nodeRecoveryPresentation({
      nodeId: "packing",
      nodeStatus: "failed",
      runLifecycle: "running",
      events: [
        event(1, "attempt.failed", { attemptId: "attempt-1", nodeId: "packing", reason: "Tests failed" }),
        event(2, "failure.classified", {
          attemptId: "attempt-1",
          nodeId: "packing",
          failureClass: "code_test",
          allowedActions: ["repair_code"],
          automaticRetryBudget: 0
        })
      ]
    });
    const stoppedRun = nodeRecoveryPresentation({
      nodeId: "packing",
      nodeStatus: "failed",
      runLifecycle: "failed",
      events: [
        event(1, "attempt.failed", { attemptId: "attempt-1", nodeId: "packing", reason: "Tests failed" }),
        event(2, "failure.classified", {
          attemptId: "attempt-1",
          nodeId: "packing",
          failureClass: "code_test",
          allowedActions: ["repair_code"],
          automaticRetryBudget: 1
        })
      ]
    });

    expect(exhausted).toBeNull();
    expect(stoppedRun).toBeNull();
  });

  it("gives every running node a non-color status label", () => {
    expect(nodeRuntimePresentation("running", null)).toEqual({
      state: "running",
      label: "En curso"
    });
  });
});

function event(seq: number, type: string, payload: Record<string, unknown>): RunEvent {
  return {
    eventId: `event-${seq}`,
    seq,
    at: "2026-08-21T00:00:00.000Z",
    runId: "run:repair",
    actor: "system",
    type,
    payload
  };
}
