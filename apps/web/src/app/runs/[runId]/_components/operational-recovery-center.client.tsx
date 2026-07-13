"use client";

import { useState } from "react";
import type { RunEvent, RunModel } from "@/lib/run-model/types";
import { selectOperationalRecovery, type RecoveryAction } from "@/lib/run-model/operational-recovery";
import { Button } from "@/components/ui/button";

const COPY: Record<ReturnType<typeof selectOperationalRecovery>["state"], { title: string; detail: string }> = {
  running: { title: "Run en progreso", detail: "La ejecución usa el event log durable; podés cancelar sólo a través del lifecycle." },
  cancelling: { title: "Cancelación en progreso", detail: "La transición terminal espera confirmación de que no quedan procesos vivos." },
  interrupted: { title: "Run interrumpido", detail: "La ejecución se detuvo con estado durable y puede reiniciarse por el flujo de recovery." },
  gated: { title: "Decisión humana requerida", detail: "Una decisión pendiente bloquea el avance. Resolvela desde el panel de decisiones." },
  partial: { title: "Resultado parcial", detail: "El artifact disponible contiene riesgo aceptado o resultados omitidos; no es éxito pleno." },
  unverified: { title: "Artifact sin verificación plena", detail: "El resultado existe, pero la evidencia de validación no alcanza para declararlo completed." },
  needs_delivery: { title: "Artifact listo para delivery", detail: "La entrega es una operación separada y requiere una acción explícita." },
  degraded: { title: "Historial degradado", detail: "Se conserva el prefijo válido del event log. Revisá la evidencia antes de continuar." },
  recovery_required: { title: "Recovery requerido", detail: "Un intento quedó ambiguo. El sistema no reintenta automáticamente para evitar efectos duplicados." },
  failed: { title: "Run fallido", detail: "La causa está preservada en el historial. Reiniciá sólo mediante la acción de lifecycle." },
  settled: { title: "Estado operativo", detail: "No hay una acción de recovery pendiente." }
};

export function OperationalRecoveryCenter({ runId, model, events }: { runId: string; model: RunModel; events: readonly RunEvent[] }): React.ReactElement | null {
  const recovery = selectOperationalRecovery(model, events);
  const [pending, setPending] = useState<RecoveryAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[recovery.state];
  const shouldRender = recovery.state !== "running" && recovery.state !== "settled";
  if (!shouldRender) return null;

  async function invoke(action: RecoveryAction): Promise<void> {
    const endpoint = action === "retry_cancel" ? "cancel" : action === "resume" ? "resume" : action === "restart" ? "restart" : null;
    if (endpoint === null) return;
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/${endpoint}`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : `La acción no pudo completarse (${response.status}).`);
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="Recovery Center" className="mx-5 mt-4 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-meta font-semibold text-[var(--color-text)]">{copy.title}</p>
          <p className="m-0 mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">{copy.detail}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {recovery.recommendedActions.includes("retry_cancel") ? <Button size="sm" onClick={() => invoke("retry_cancel")} disabled={pending !== null}>{model.run.control.status === "cancelling" ? "Reintentar cancelación" : "Cancelar run"}</Button> : null}
          {recovery.recommendedActions.includes("resume") ? <Button size="sm" onClick={() => invoke("resume")} disabled={pending !== null}>Reanudar</Button> : null}
          {recovery.recommendedActions.includes("restart") ? <Button size="sm" onClick={() => invoke("restart")} disabled={pending !== null}>Reiniciar</Button> : null}
          {recovery.recommendedActions.includes("export_artifact") ? <a className="inline-flex h-8 items-center rounded-[var(--r-md)] border border-[var(--color-border)] px-3 text-meta font-medium text-[var(--color-text)]" href={`/api/runs/${encodeURIComponent(runId)}/export?format=patch`}>Exportar artifact</a> : null}
        </div>
      </div>
      {recovery.cancellation !== undefined ? <p className="m-0 mt-3 text-meta text-[var(--color-text-muted)]">Procesos verificados: {recovery.cancellation.allDead === true ? "todos terminados" : `${recovery.cancellation.survivors.length} pendiente(s)`}.</p> : null}
      {recovery.pendingDecisionIds.length > 0 ? <p className="m-0 mt-3 text-meta text-[var(--color-text-muted)]">Decisiones pendientes: {recovery.pendingDecisionIds.join(", ")}. Resolvelas en el control-plane de decisiones.</p> : null}
      {recovery.blockingReasons.map((reason) => <p key={reason} className="m-0 mt-2 text-meta text-[var(--color-text-muted)]">{reason}</p>)}
      {error !== null ? <p role="alert" className="m-0 mt-3 text-meta text-[var(--color-danger)]">{error}</p> : null}
    </section>
  );
}
