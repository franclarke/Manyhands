import type { RunEvent, RunModel } from "./types";
import { hasTerminalOrArtifactControlStatus } from "./selectors";

export type RecoveryAction = "resume" | "restart" | "retry_cancel" | "resolve_decision" | "deliver" | "export_artifact";

export interface OperationalRecoveryView {
  state: "running" | "cancelling" | "interrupted" | "gated" | "partial" | "unverified" | "needs_delivery" | "degraded" | "recovery_required" | "failed" | "settled";
  blockingReasons: string[];
  pendingDecisionIds: string[];
  recommendedActions: RecoveryAction[];
  canResume: boolean;
  canRetry: boolean;
  canCancel: boolean;
  canResolveDecision: boolean;
  canRetryDelivery: boolean;
  artifactAvailability: "none" | "partial" | "unverified" | "ready";
  deliveryState: "none" | "needs_delivery" | "failed" | "completed";
  failure?: { cause: string; nodeId?: string; eventSeq?: number };
  cancellation?: { allDead: boolean | undefined; survivors: number[] } | undefined;
}

/**
 * A pure operational projection. It deliberately consumes durable run control
 * plus native events; components never infer recovery from error strings.
 */
export function selectOperationalRecovery(model: RunModel, events: readonly RunEvent[]): OperationalRecoveryView {
  const status = model.run.control.status;
  const pendingDecisionIds = hasTerminalOrArtifactControlStatus(status)
    ? []
    : Array.from(model.decisions.values())
    .filter((decision) => decision.status === "pending" && decision.blocking)
    .map((decision) => decision.id);
  const cancellationEvent = [...events].reverse().find((event) => event.type === "run.cancelled");
  const cancellationPayload = cancellationEvent?.payload as { allDead?: boolean; survivors?: number[] } | undefined;
  const hasDegradedLog = events.some((event) => event.type === "checkpoint.degraded" || event.type === "checkpoint.lost");
  const hasRecoveryRequired = events.some((event) => event.type === "task.attempt.recovery_required");
  const failure = selectFailureCause(model, events);

  const artifactAvailability = status === "partial"
    ? "partial"
    : status === "unverified"
      ? "unverified"
      : ["completed", "completed_with_accepted", "needs_delivery"].includes(status)
        ? "ready"
        : "none";
  const deliveryState = status === "needs_delivery"
    ? "needs_delivery"
    : status === "failed_delivery"
      ? "failed"
      : artifactAvailability === "ready" && status === "completed"
        ? "completed"
        : "none";

  const blockingReasons: string[] = [];
  let state: OperationalRecoveryView["state"] = "settled";
  if (["failed", "failed_artifact", "failed_delivery"].includes(status)) {
    state = "failed";
    blockingReasons.push("El run terminó con un fallo durable. La decisión pendiente, si existía, se conserva sólo como historial.");
  } else if (hasDegradedLog) {
    state = "degraded";
    blockingReasons.push("El historial durable tiene un prefijo válido, pero requiere reconciliación antes de confiar en eventos posteriores.");
  } else if (hasRecoveryRequired) {
    state = "recovery_required";
    blockingReasons.push("Hay un intento ambiguo; no se reintenta automáticamente para no duplicar efectos externos.");
  } else if (pendingDecisionIds.length > 0 || status === "paused" || status === "needs_review") {
    state = "gated";
    blockingReasons.push("Una decisión humana pendiente bloquea el avance del run.");
  } else if (status === "cancelling") {
    state = "cancelling";
    blockingReasons.push(cancellationPayload?.allDead === false
      ? `La cancelación espera ${cancellationPayload.survivors?.length ?? 0} proceso(s) superviviente(s).`
      : "La cancelación todavía está verificando que todos los procesos hayan terminado.");
  } else if (status === "interrupted") {
    state = "interrupted";
    blockingReasons.push("El run fue interrumpido y puede reanudarse sólo por el flujo de lifecycle correspondiente.");
  } else if (status === "partial" || status === "completed_with_accepted") {
    state = "partial";
    blockingReasons.push("El artifact contiene riesgo aceptado, tareas omitidas o resultados parciales; no es éxito pleno.");
  } else if (status === "unverified") {
    state = "unverified";
    blockingReasons.push("El artifact existe, pero la validación final no demuestra éxito pleno.");
  } else if (status === "needs_delivery") {
    state = "needs_delivery";
    blockingReasons.push("El artifact está separado de su entrega y requiere una acción de delivery explícita.");
  } else if (["generating", "approved", "running"].includes(status)) {
    state = "running";
  }

  const canCancel = ["generating", "running", "paused", "cancelling"].includes(status);
  const canResume = status === "interrupted" || status === "paused";
  const canRetry = ["failed", "failed_artifact", "failed_delivery", "interrupted", "cancelling"].includes(status);
  const canResolveDecision = pendingDecisionIds.length > 0;
  const canRetryDelivery = status === "needs_delivery" || status === "failed_delivery";
  const recommendedActions: RecoveryAction[] = [];
  if (canResolveDecision) recommendedActions.push("resolve_decision");
  if (status === "cancelling") recommendedActions.push("retry_cancel");
  else if (canCancel) recommendedActions.push("retry_cancel");
  if (canResume && status !== "paused") recommendedActions.push("resume");
  if (status === "failed" || status === "failed_artifact" || status === "interrupted") recommendedActions.push("restart");
  if (canRetryDelivery) recommendedActions.push("deliver");
  if (artifactAvailability !== "none") recommendedActions.push("export_artifact");

  return {
    state,
    blockingReasons,
    pendingDecisionIds,
    recommendedActions,
    canResume,
    canRetry,
    canCancel,
    canResolveDecision,
    canRetryDelivery,
    artifactAvailability,
    deliveryState,
    ...(failure !== undefined ? { failure } : {}),
    ...(cancellationPayload !== undefined
      ? { cancellation: { allDead: cancellationPayload.allDead, survivors: cancellationPayload.survivors ?? [] } }
      : {})
  };
}

function selectFailureCause(
  model: RunModel,
  events: readonly RunEvent[]
): { cause: string; nodeId?: string; eventSeq?: number } | undefined {
  for (const event of [...events].reverse()) {
    if (event.type === "node.execution.failed" || event.type === "node.verify.failed") {
      const payload = event.payload as { cause?: unknown; nodeId?: unknown };
      if (typeof payload.cause === "string" && payload.cause.trim().length > 0) {
        return {
          cause: payload.cause,
          ...(typeof payload.nodeId === "string" ? { nodeId: payload.nodeId } : {}),
          eventSeq: event.seq
        };
      }
    }
    if (event.type === "plan.node.status") {
      const payload = event.payload as { state?: unknown; errorMessage?: unknown; nodeId?: unknown };
      if (payload.state === "failed" && typeof payload.errorMessage === "string" && payload.errorMessage.trim().length > 0) {
        return {
          cause: payload.errorMessage,
          ...(typeof payload.nodeId === "string" ? { nodeId: payload.nodeId } : {}),
          eventSeq: event.seq
        };
      }
    }
  }
  return model.run.errorMessage === undefined || model.run.errorMessage.trim().length === 0
    ? undefined
    : { cause: model.run.errorMessage };
}
