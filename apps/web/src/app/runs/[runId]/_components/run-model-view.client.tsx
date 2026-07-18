"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleStop, Pause, Play, RotateCcw, Send, X } from "lucide-react";

import { RunGraphCanvas } from "@/components/run-model/minimal-run-graph";
import { useLiveRunModel } from "@/components/run-model/use-live-run-model";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type { RunEvent, RunSeed } from "@/lib/run-model/types";
import { runUiStatus, statusMeta } from "@/lib/status";

export function RunModelView({
  seed,
  initialEvents,
  workspaceName,
  fixture = false
}: {
  seed: RunSeed;
  initialEvents: RunEvent[];
  workspaceName?: string | undefined;
  fixture?: boolean;
}): React.ReactElement {
  const live = useLiveRunModel(seed, initialEvents, { disabled: fixture });
  const model = live.model;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedNode = model.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const pendingDecisions = model.projection === null
    ? []
    : Object.values(model.projection.decisions).filter((decision) => decision.status === "pending");
  const activeDecision = pendingDecisions.find((decision) => decision.id === decisionId) ?? null;
  const uiStatus = runUiStatus(model.run.lifecycle);

  const selectedContract = useMemo(
    () => model.contracts.find((bundle) => bundle.task.nodeId === selectedNodeId) ?? null,
    [model.contracts, selectedNodeId]
  );

  async function command(path: string, body?: unknown): Promise<void> {
    if (fixture) return;
    setBusyAction(path);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(seed.id)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `La operación falló (${response.status}).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction(null);
    }
  }

  async function resolveDecision(optionId: string): Promise<void> {
    if (activeDecision === null) return;
    await command(`decisions/${encodeURIComponent(activeDecision.id)}`, { optionId });
    setDecisionId(null);
  }

  async function deliver(): Promise<void> {
    const candidate = model.projection?.finalCandidate;
    if (candidate === undefined) return;
    await command("deliver", {
      manifestId: candidate.manifestId,
      finalSha: candidate.commit,
      targetBranch: candidate.targetBranch,
      targetHead: candidate.targetHead,
      targetFingerprint: candidate.sourceTargetFingerprint,
      actor: "operator",
      idempotencyKey: `${seed.id}:${candidate.manifestId}:${candidate.commit}`
    });
  }

  return (
    <main className="flex h-dvh min-h-[680px] flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="flex shrink-0 items-center justify-between gap-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-micro text-[var(--color-text-subtle)]">
            <span className="mh-mono uppercase tracking-[0.12em]">{workspaceName ?? "ManyHands"}</span>
            <span>·</span>
            <span>{live.connected ? "historial sincronizado" : live.connection}</span>
          </div>
          <h1 className="truncate text-lg font-semibold">{model.run.title}</h1>
          <p className="mt-0.5 max-w-[760px] truncate text-xs text-[var(--color-text-muted)]">{model.run.goal}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={uiStatus} label={statusMeta(uiStatus).label} />
          {!fixture ? <RunActions lifecycle={model.run.lifecycle} busy={busyAction} onCommand={command} onDeliver={() => void deliver()} /> : null}
        </div>
      </header>

      {pendingDecisions.length > 0 ? (
        <div className="flex shrink-0 gap-3 overflow-x-auto border-b border-[var(--status-review-border)] bg-[var(--status-review-bg)] px-6 py-3">
          {pendingDecisions.map((decision) => (
            <button
              key={decision.id}
              type="button"
              onClick={() => setDecisionId(decision.id)}
              className="flex min-w-[360px] items-center justify-between gap-4 rounded-lg border border-[var(--status-review-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-raised)]"
            >
              <span className="flex min-w-0 items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-review-fg)]" />
                <span className="min-w-0"><strong className="block truncate text-sm">{decision.question}</strong><small className="mt-0.5 block text-[var(--color-text-muted)]">Afecta {decision.affectedNodeIds.length} nodo{decision.affectedNodeIds.length === 1 ? "" : "s"}; el resto puede continuar.</small></span>
              </span>
              <span className="text-xs font-medium text-[var(--status-review-fg)]">Responder</span>
            </button>
          ))}
        </div>
      ) : null}

      {error !== null ? (
        <div role="alert" className="flex shrink-0 items-center justify-between border-b border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] px-6 py-2 text-xs text-[var(--status-failed-fg)]">
          <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Cerrar error"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px]">
        <section className="relative min-h-0 border-r border-[var(--color-border)]">
          <div className="absolute left-4 top-4 z-10 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]/95 px-3 py-2 text-eyebrow text-[var(--color-text-muted)] shadow-sm backdrop-blur">
            <span><i className="mr-1 inline-block h-0.5 w-4 bg-[var(--color-border-strong)] align-middle" /> jerarquía</span>
            <span><i className="mr-1 inline-block h-0.5 w-4 bg-[var(--color-accent)] align-middle" /> artefacto</span>
            <span><i className="mr-1 inline-block h-0.5 w-4 border-t border-dashed border-[var(--status-review-fg)] align-middle" /> contrato</span>
            <span><i className="mr-1 inline-block h-0.5 w-4 border-t border-dotted border-[var(--error)] align-middle" /> conflicto</span>
          </div>
          <RunGraphCanvas model={model} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
        </section>

        <aside className="min-h-0 overflow-y-auto bg-[var(--color-surface)]">
          {selectedNode === null ? (
            <RunSummary model={model} />
          ) : (
            <NodeDetails node={selectedNode} contract={selectedContract} onClose={() => setSelectedNodeId(null)} />
          )}
          <Activity events={model.events} />
        </aside>
      </div>

      {activeDecision !== null ? (
        <dialog open className="fixed inset-0 z-50 m-auto w-[min(560px,calc(100vw-32px))] rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-black/55">
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <div className="flex items-start justify-between gap-4"><div><span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--status-review-fg)]">Decisión humana</span><h2 className="mt-1 text-base font-semibold">{activeDecision.question}</h2></div><button type="button" onClick={() => setDecisionId(null)} aria-label="Cerrar"><X className="h-4 w-4" /></button></div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">Esta respuesta desbloquea sólo los nodos afectados. Las ramas independientes no se detienen.</p>
          </div>
          <div className="grid gap-2 p-5">
            {activeDecision.options.map((option) => (
              <button key={option.id} type="button" disabled={busyAction !== null} onClick={() => void resolveDecision(option.id)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:border-[var(--color-accent)]">
                <strong className="block text-sm">{option.label}</strong>{option.description !== undefined ? <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{option.description}</span> : null}
              </button>
            ))}
          </div>
        </dialog>
      ) : null}
    </main>
  );
}

function RunActions({ lifecycle, busy, onCommand, onDeliver }: { lifecycle: RunSeed["lifecycle"]; busy: string | null; onCommand: (path: string, body?: unknown) => Promise<void>; onDeliver: () => void }): React.ReactElement {
  return (
    <div className="flex items-center gap-1">
      {lifecycle === "running" || lifecycle === "waiting_for_input" ? <Button size="sm" busy={busy === "pause"} onClick={() => void onCommand("pause", { reason: "Pausado por el operador" })}><Pause className="h-3.5 w-3.5" />Pausar</Button> : null}
      {lifecycle === "paused" ? <Button size="sm" busy={busy === "resume"} onClick={() => void onCommand("resume", { reason: "Reanudado por el operador" })}><Play className="h-3.5 w-3.5" />Continuar</Button> : null}
      {lifecycle === "interrupted" ? <Button size="sm" busy={busy === "restart"} onClick={() => void onCommand("restart")}><RotateCcw className="h-3.5 w-3.5" />Reintentar</Button> : null}
      {lifecycle === "result_ready" ? <Button variant="primary" size="sm" busy={busy === "deliver"} onClick={onDeliver}><Send className="h-3.5 w-3.5" />Publicar resultado</Button> : null}
      {["planning", "needs_approval", "running", "waiting_for_input", "paused", "result_ready"].includes(lifecycle) ? <Button variant="danger" size="icon" busy={busy === "cancel"} onClick={() => void onCommand("cancel")} aria-label="Cancelar run"><CircleStop className="h-4 w-4" /></Button> : null}
    </div>
  );
}

function RunSummary({ model }: { model: ReturnType<typeof useLiveRunModel>["model"] }): React.ReactElement {
  const done = model.nodes.filter((node) => node.status === "succeeded").length;
  const active = model.nodes.filter((node) => node.status === "running").length;
  const waiting = model.nodes.filter((node) => node.status === "waiting").length;
  return (
    <section className="border-b border-[var(--color-border)] p-5">
      <span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">Estado del objetivo</span>
      <h2 className="mt-2 text-sm font-semibold">{model.graphPhase === "provisional" ? `Construyendo el grafo · ${model.nodes.length} nodo${model.nodes.length === 1 ? "" : "s"} identificado${model.nodes.length === 1 ? "" : "s"}` : model.graph === null ? "Preparando el plan" : `${done} de ${model.nodes.length} nodos con resultado`}</h2>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center"><Metric value={active} label="activos" /><Metric value={waiting} label="esperan" /><Metric value={model.contracts.length} label="contratos" /></div>
      {model.projection?.finalCandidate !== undefined ? <div className="mt-4 rounded-lg border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] p-3 text-xs text-[var(--status-completed-fg)]"><CheckCircle2 className="mr-2 inline h-4 w-4" />Resultado verificado listo para publicar.</div> : null}
      {model.projection?.failureReason !== undefined ? <div className="mt-4 rounded-lg border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] p-3 text-xs text-[var(--status-failed-fg)]">{model.projection.failureReason}</div> : null}
    </section>
  );
}

function Metric({ value, label }: { value: number; label: string }): React.ReactElement { return <div className="rounded-lg bg-[var(--color-bg-subtle)] p-2"><strong className="block text-base">{value}</strong><span className="text-eyebrow text-[var(--color-text-subtle)]">{label}</span></div>; }

function NodeDetails({ node, contract, onClose }: { node: ReturnType<typeof useLiveRunModel>["model"]["nodes"][number]; contract: ReturnType<typeof useLiveRunModel>["model"]["contracts"][number] | null; onClose: () => void }): React.ReactElement {
  return (
    <section className="border-b border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between gap-4"><div><span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">{node.kind}</span><h2 className="mt-1 text-sm font-semibold">{node.title}</h2></div><button type="button" onClick={onClose} aria-label="Cerrar detalle"><X className="h-4 w-4" /></button></div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">{node.goal}</p>
      {contract !== null ? <div className="mt-5 space-y-4 text-xs"><Detail label="Alcance" value={`${contract.scope.allowedPaths.length} rutas permitidas`} /><Detail label="Criterios" value={`${contract.task.acceptanceCriteria.length} condiciones verificables`} /><Detail label="Entradas / salidas" value={`${contract.task.consumes.length} / ${contract.task.produces.length}`} /><div><span className="mb-2 block text-eyebrow uppercase tracking-wide text-[var(--color-text-subtle)]">Aceptación</span><ul className="space-y-1.5">{contract.task.acceptanceCriteria.map((criterion) => <li key={criterion.id} className="rounded bg-[var(--color-bg-subtle)] p-2">{criterion.description}</li>)}</ul></div></div> : <p className="mt-4 text-xs text-[var(--color-text-subtle)]">Este nodo agrupa trabajo; sus contratos viven en los nodos ejecutables.</p>}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }): React.ReactElement { return <div><span className="block text-eyebrow uppercase tracking-wide text-[var(--color-text-subtle)]">{label}</span><span className="mt-1 block">{value}</span></div>; }

function Activity({ events }: { events: readonly RunEvent[] }): React.ReactElement {
  return <section className="p-5"><span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">Actividad canónica</span><ol className="mt-3 space-y-3">{events.slice(-16).reverse().map((event) => <li key={event.eventId} className="flex gap-3 text-xs"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" /><span><strong className="block font-medium">{eventLabel(event.type)}</strong><small className="text-[var(--color-text-subtle)]">#{event.seq} · {new Date(event.at).toLocaleTimeString()}</small></span></li>)}</ol></section>;
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    "run.created": "Objetivo registrado",
    "repository.inspected": "Repositorio comprendido",
    "planning.attempt_started": "Planificación iniciada",
    "planning.node_discovered": "Nodo identificado",
    "planning.attempt_failed": "Intento de planificación descartado",
    "planning.failed": "Planificación fallida",
    "planning.completed": "Trabajo desglosado",
    "graph.compiled": "Grafo y contratos compilados",
    "graph.revision.approved": "Plan aprobado",
    "wave.selected": "Nueva ola de trabajo",
    "attempt.started": "Agente iniciado",
    "attempt.candidate_created": "Cambio candidato creado",
    "validation.completed": "Validación completada",
    "artifact.adopted": "Artefacto adoptado",
    "integration.started": "Integración iniciada",
    "integration.completed": "Integración completada",
    "decision.raised": "Decisión solicitada",
    "decision.resolved": "Decisión respondida",
    "final_candidate.verified": "Resultado final verificado",
    "delivery.published": "Resultado publicado",
    "run.failed": "Run fallido"
  };
  return labels[type] ?? type.replaceAll(".", " · ");
}
