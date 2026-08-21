import type { RunEvent, RunNodeView, RunSeed } from "./types";

export type NodeRecoveryPresentation =
  | { phase: "queued"; label: "Preparando reparación"; detail: string }
  | { phase: "repairing"; label: "Reparando"; detail: string };

export type NodeRuntimePresentation =
  | { state: "running"; label: "En curso"; detail?: undefined }
  | { state: "repairing"; label: "Reparando"; detail: string }
  | { state: "repair_queued"; label: "Preparando reparación"; detail: string }
  | { state: "idle"; label: string; detail?: undefined };

/**
 * Reads the recovery facts already present in the canonical run event stream.
 * A failed attempt is not a failed node when the coordinator classified it as
 * repairable and still owns an automatic retry, or when its replacement attempt
 * is already running.
 */
export function nodeRecoveryPresentation(input: {
  nodeId: string;
  nodeStatus: RunNodeView["status"];
  runLifecycle: RunSeed["lifecycle"];
  events: readonly RunEvent[];
}): NodeRecoveryPresentation | null {
  if (!["running", "waiting_for_input"].includes(input.runLifecycle)) return null;
  if (!["running", "failed"].includes(input.nodeStatus)) return null;

  const orderedEvents = input.events.slice().sort((left, right) => left.seq - right.seq);
  const events = orderedEvents.filter((event) => event.payload.nodeId === input.nodeId);
  const latestFailure = [...events].reverse().find((event) => event.type === "attempt.failed");
  const latestStart = [...events].reverse().find((event) => event.type === "attempt.started");
  const latestRepairPass = [...events].reverse().find((event) => event.type === "attempt.repair_attempted");

  if (input.nodeStatus === "running") {
    const retryOfAttemptId = stringValue(latestStart?.payload.retryOfAttemptId);
    const failedAttemptId = stringValue(latestFailure?.payload.attemptId);
    const isRetry = retryOfAttemptId !== undefined
      && latestStart !== undefined
      && latestFailure !== undefined
      && latestStart.seq > latestFailure.seq
      && (failedAttemptId === undefined || retryOfAttemptId === failedAttemptId);
    const isInlineRepair = latestRepairPass !== undefined
      && (latestStart === undefined || latestRepairPass.seq > latestStart.seq);
    if (isRetry || isInlineRepair) {
      return {
        phase: "repairing",
        label: "Reparando",
        detail: "Un nuevo intento está corrigiendo el fallo. El resto del Run puede seguir avanzando."
      };
    }
  }

  if (input.nodeStatus !== "failed" || latestFailure === undefined) return null;
  const failedAttemptId = stringValue(latestFailure.payload.attemptId);
  if (retryWasAuthorized(input.nodeId, latestFailure.seq, orderedEvents)) {
    return {
      phase: "queued",
      label: "Preparando reparación",
      detail: "La reparación fue autorizada. El Run conserva el trabajo válido y prepara el nuevo intento."
    };
  }
  const classification = [...events].reverse().find((event) => (
    event.type === "failure.classified"
    && event.seq > latestFailure.seq
    && (event.payload.attemptId === undefined || event.payload.attemptId === failedAttemptId)
  ));
  if (classification === undefined || !hasAutomaticRepair(classification.payload)) return null;
  return {
    phase: "queued",
    label: "Preparando reparación",
    detail: "El fallo es recuperable. El Run conserva el trabajo válido y prepara un nuevo intento."
  };
}

function retryWasAuthorized(nodeId: string, afterSequence: number, events: readonly RunEvent[]): boolean {
  const raised = [...events].reverse().find((event) => {
    if (event.type !== "decision.raised" || event.seq <= afterSequence || !isRecord(event.payload.decision)) return false;
    const decision = event.payload.decision;
    const targets = Array.isArray(decision.affectedNodeIds) ? decision.affectedNodeIds : [];
    const options = Array.isArray(decision.options) ? decision.options : [];
    return (decision.repairTargetNodeId === nodeId || targets.includes(nodeId))
      && options.some((option) => isRecord(option) && option.id === "retry");
  });
  if (raised === undefined || !isRecord(raised.payload.decision)) return false;
  const decisionId = stringValue(raised.payload.decision.id);
  if (decisionId === undefined) return false;
  return events.some((event) => (
    event.type === "decision.resolved"
    && event.seq > raised.seq
    && event.payload.decisionId === decisionId
    && event.payload.optionId === "retry"
  ));
}

export function nodeRuntimePresentation(
  status: RunNodeView["status"],
  recovery: NodeRecoveryPresentation | null
): NodeRuntimePresentation {
  if (recovery?.phase === "repairing") {
    return { state: "repairing", label: recovery.label, detail: recovery.detail };
  }
  if (recovery?.phase === "queued") {
    return { state: "repair_queued", label: recovery.label, detail: recovery.detail };
  }
  if (status === "running") return { state: "running", label: "En curso" };
  return { state: "idle", label: STATUS_LABELS[status] };
}

function hasAutomaticRepair(payload: Record<string, unknown>): boolean {
  const actions = Array.isArray(payload.allowedActions)
    ? payload.allowedActions.filter((action): action is string => typeof action === "string")
    : [];
  return typeof payload.automaticRetryBudget === "number"
    && payload.automaticRetryBudget > 0
    && actions.some((action) => action.includes("repair") || action.includes("retry"));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUS_LABELS: Record<RunNodeView["status"], string> = {
  pending: "Pendiente",
  ready: "Listo",
  running: "En curso",
  waiting: "Esperando",
  succeeded: "Completo",
  failed: "Falló",
  stale: "Obsoleto"
};
