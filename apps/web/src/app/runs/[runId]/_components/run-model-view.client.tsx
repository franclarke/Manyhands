"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleStop, PanelRightClose, PanelRightOpen, Pause, Play, RotateCcw, Send, X } from "lucide-react";

import { RunGraphCanvas } from "@/components/run-model/minimal-run-graph";
import { useLiveRunModel } from "@/components/run-model/use-live-run-model";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusPill } from "@/components/ui/status-pill";
import { eventPresentation, summarizeRunNodes } from "@/lib/run-model/presentation";
import type { RunEvent, RunSeed } from "@/lib/run-model/types";
import { runUiStatus, statusMeta } from "@/lib/status";

export function RunModelView({
  seed,
  initialEvents,
  workspaceName,
  fixture = false,
  fixtureToolbar
}: {
  seed: RunSeed;
  initialEvents: RunEvent[];
  workspaceName?: string | undefined;
  fixture?: boolean;
  fixtureToolbar?: React.ReactNode;
}): React.ReactElement {
  const live = useLiveRunModel(seed, initialEvents, { disabled: fixture });
  const model = live.model;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [autoFit, setAutoFit] = useState(true);
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

  function openDecision(nextDecisionId: string): void {
    const decision = pendingDecisions.find((candidate) => candidate.id === nextDecisionId);
    setDecisionId(nextDecisionId);
    setInspectorCollapsed(false);
    const affectedNodeId = decision?.affectedNodeIds[0];
    if (affectedNodeId !== undefined) setSelectedNodeId(affectedNodeId);
  }

  function selectNode(nodeId: string | null): void {
    setSelectedNodeId(nodeId);
    if (nodeId !== null) setInspectorCollapsed(false);
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
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="mh-mono hidden max-w-56 shrink-0 truncate text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)] lg:block">{workspaceName ?? "ManyHands"}</span>
            <span aria-hidden className="hidden text-micro text-[var(--color-text-subtle)] lg:block">·</span>
            <h1 className="truncate text-base font-semibold">{model.run.title}</h1>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-micro text-[var(--color-text-muted)]">
            <p className="truncate">{model.run.goal}</p>
            <span aria-hidden className="shrink-0 text-[var(--color-text-subtle)]">·</span>
            <span className="shrink-0 text-[var(--color-text-subtle)]">{fixture ? "historial de muestra" : live.connected ? "sincronizado" : live.connection}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={uiStatus} label={statusMeta(uiStatus).label} />
          {!fixture ? <RunActions lifecycle={model.run.lifecycle} busy={busyAction} onCommand={command} onDeliver={() => void deliver()} /> : null}
        </div>
      </header>

      {fixtureToolbar}

      {pendingDecisions.length > 0 ? (
        <section aria-label="Decisiones pendientes" className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--status-review-border)] bg-[var(--status-review-bg)] px-4 py-1.5">
          {pendingDecisions.map((decision) => (
            <button
              key={decision.id}
              type="button"
              onClick={() => openDecision(decision.id)}
              className="group flex min-w-[min(100%,480px)] max-w-[760px] flex-1 items-center justify-between gap-3 rounded-[var(--r-md)] border border-[var(--status-review-border)] bg-[var(--color-surface)] px-3 py-2 text-left transition-[border-color,background-color] duration-150 hover:border-[var(--status-review-fg)] hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--status-review-fg)]"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--status-review-bg)] text-[var(--status-review-fg)]"><AlertTriangle className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 truncate text-xs"><small className="mh-mono mr-2 text-eyebrow uppercase tracking-[0.11em] text-[var(--status-review-fg)]">Decisión pendiente · {decision.affectedNodeIds.length} nodo{decision.affectedNodeIds.length === 1 ? "" : "s"}</small>{" "}<strong>{affectedNodeLabel(decision.affectedNodeIds, model.nodes)}</strong><small className="ml-2 hidden truncate text-[var(--color-text-muted)] 2xl:inline">{decisionReason(decision.question, model.nodes, decision.affectedNodeIds)}</small></span>
              </span>
              <span className="shrink-0 text-label font-semibold text-[var(--status-review-fg)] group-hover:underline">Revisar <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </section>
      ) : null}

      {error !== null ? (
        <div role="alert" className="flex shrink-0 items-center justify-between border-b border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] px-6 py-2 text-xs text-[var(--status-failed-fg)]">
          <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Cerrar error"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <div className={`grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 motion-reduce:transition-none ${inspectorCollapsed ? "grid-cols-[minmax(0,1fr)_0px]" : "grid-cols-[minmax(0,1fr)_340px]"}`}>
        <section className={`relative min-h-0 ${inspectorCollapsed ? "" : "border-r border-[var(--color-border)]"}`}>
          <RunGraphCanvas
            model={model}
            selectedNodeId={selectedNodeId}
            onSelectNode={selectNode}
            autoFit={autoFit}
            onAutoFitChange={setAutoFit}
          />
          <IconButton
            label={inspectorCollapsed ? "Mostrar panel de detalles" : "Ocultar panel de detalles"}
            aria-label={inspectorCollapsed ? "Mostrar panel de detalles" : "Ocultar panel de detalles"}
            aria-expanded={!inspectorCollapsed}
            aria-controls="run-inspector"
            onClick={() => setInspectorCollapsed((collapsed) => !collapsed)}
            className="absolute right-3 top-3 z-20 h-8 w-8 border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-sm"
          >
            {inspectorCollapsed ? <PanelRightOpen aria-hidden className="h-4 w-4" /> : <PanelRightClose aria-hidden className="h-4 w-4" />}
          </IconButton>
        </section>

        <aside id="run-inspector" aria-hidden={inspectorCollapsed} className="min-h-0 overflow-y-auto overflow-x-hidden bg-[var(--color-surface)]">
          {!inspectorCollapsed ? (
            <>
              {activeDecision !== null ? (
                <DecisionDetails decision={activeDecision} nodes={model.nodes} busy={busyAction !== null} onResolve={(optionId) => void resolveDecision(optionId)} onDismiss={() => setDecisionId(null)} />
              ) : selectedNode === null ? (
                <RunSummary model={model} />
              ) : (
                <NodeDetails node={selectedNode} contract={selectedContract} onClose={() => setSelectedNodeId(null)} />
              )}
              <Activity events={model.events} />
            </>
          ) : null}
        </aside>
      </div>

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
  const summary = summarizeRunNodes(model.nodes);
  const resultLabel = summary.executableCount === 0
    ? "Sin trabajo ejecutable todavía"
    : `${summary.completedExecutables} de ${summary.executableCount} ejecutables con resultado`;
  return (
    <section className="border-b border-[var(--color-border)] p-5">
      <span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">Estado del objetivo</span>
      <h2 className="mt-2 text-balance text-sm font-semibold">{model.graphPhase === "provisional" ? `Construyendo el grafo · ${model.nodes.length} nodo${model.nodes.length === 1 ? "" : "s"} identificado${model.nodes.length === 1 ? "" : "s"}` : model.graph === null ? "Preparando el plan" : resultLabel}</h2>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Metric value={summary.activeAgents} label="agentes" />
        <Metric value={summary.blockedAgents} label="bloqueados" />
        <Metric value={`${summary.completedExecutables}/${summary.executableCount}`} label="resultados" />
      </div>
      <p className="mt-3 text-pretty text-micro text-[var(--color-text-subtle)]">
        {summary.coordinatingNodes > 0 ? `${summary.coordinatingNodes} nodo coordinando · ` : ""}{model.contracts.length} contrato{model.contracts.length === 1 ? "" : "s"} vigente{model.contracts.length === 1 ? "" : "s"}
      </p>
      {model.projection?.finalCandidate !== undefined ? <div className="mt-4 rounded-lg border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] p-3 text-xs text-[var(--status-completed-fg)]"><CheckCircle2 className="mr-2 inline h-4 w-4" />Resultado verificado listo para publicar.</div> : null}
      {model.projection?.failureReason !== undefined ? <div className="mt-4 rounded-lg border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] p-3 text-xs text-[var(--status-failed-fg)]">{model.projection.failureReason}</div> : null}
    </section>
  );
}

function Metric({ value, label }: { value: number | string; label: string }): React.ReactElement { return <div className="rounded-lg bg-[var(--color-bg-subtle)] p-2"><strong className="block text-base tabular-nums">{value}</strong><span className="text-eyebrow text-[var(--color-text-subtle)]">{label}</span></div>; }

function DecisionDetails({ decision, nodes, busy, onResolve, onDismiss }: { decision: NonNullable<ReturnType<typeof useLiveRunModel>["model"]["projection"]>["decisions"][string]; nodes: ReturnType<typeof useLiveRunModel>["model"]["nodes"]; busy: boolean; onResolve: (optionId: string) => void; onDismiss: () => void }): React.ReactElement {
  const affectedLabel = affectedNodeLabel(decision.affectedNodeIds, nodes);
  return (
    <section className="border-b border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between gap-4"><div><span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--status-review-fg)]">Decisión requerida</span><h2 className="mt-1 text-base font-semibold">{affectedLabel}</h2></div><button type="button" onClick={onDismiss} aria-label="Cerrar decisiones" className="rounded-md p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"><X className="h-4 w-4" /></button></div>
      <div className="mt-4 rounded-lg border border-[var(--status-review-border)] bg-[var(--status-review-bg)] p-3">
        <span className="block text-eyebrow font-semibold uppercase tracking-[0.1em] text-[var(--status-review-fg)]">Qué necesita resolución</span>
        <p className="mt-1.5 text-xs leading-5 text-[var(--color-text)]">{decisionReason(decision.question, nodes, decision.affectedNodeIds)}</p>
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">Esta respuesta se aplica a {decision.affectedNodeIds.length === 1 ? "este nodo" : "estos nodos"}; las ramas independientes siguen su curso.</p>
      <div className="mt-5"><span className="mh-mono block text-eyebrow uppercase tracking-[0.11em] text-[var(--color-text-subtle)]">Elegí una acción</span><div className="mt-2 grid gap-2">
        {decision.options.map((option, index) => (
          <button key={option.id} type="button" disabled={busy} onClick={() => onResolve(option.id)} className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px hover:border-[var(--status-review-fg)] hover:bg-[var(--color-surface-raised)] disabled:cursor-wait disabled:opacity-60">
            <span className="flex items-start gap-3"><span className="mh-mono mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--color-border-strong)] text-eyebrow text-[var(--color-text-subtle)]">{index + 1}</span><span><strong className="block text-sm">{option.label}</strong>{option.description !== undefined ? <span className="mt-1 block text-xs leading-5 text-[var(--color-text-muted)]">{option.description}</span> : null}</span></span>
          </button>
        ))}
      </div></div>
    </section>
  );
}

function affectedNodeLabel(nodeIds: readonly string[], nodes: ReturnType<typeof useLiveRunModel>["model"]["nodes"]): string {
  const titles = nodeIds.map((nodeId) => nodes.find((node) => node.id === nodeId)?.title ?? nodeId);
  return titles.length === 1 ? titles[0]! : `${titles.slice(0, 2).join(" y ")}${titles.length > 2 ? ` y ${titles.length - 2} más` : ""}`;
}

function decisionReason(question: string, nodes: ReturnType<typeof useLiveRunModel>["model"]["nodes"], nodeIds: readonly string[]): string {
  const target = affectedNodeLabel(nodeIds, nodes);
  const prefix = `The work for ${target} needs guidance:`;
  const detail = question.startsWith(prefix) ? question.slice(prefix.length).trim() : question;
  if (detail === "Validation outcome is unverified.") return "La validación terminó sin evidencia suficiente para verificar el resultado.";
  return detail;
}

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
  const presented = events.map((event) => ({ event, presentation: eventPresentation(event.type) }));
  const operational = presented.filter((entry) => !entry.presentation.diagnostic).slice(-12).reverse();
  const diagnostic = presented.filter((entry) => entry.presentation.diagnostic).reverse();
  return (
    <section className="p-5">
      <span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">Actividad reciente</span>
      <ol className="mt-3 space-y-3">
        {operational.map((entry) => <ActivityEvent key={entry.event.eventId} {...entry} />)}
      </ol>
      {diagnostic.length > 0 ? (
        <details className="mt-4 border-t border-[var(--color-border)] pt-3 text-xs">
          <summary className="cursor-pointer select-none text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            Detalles técnicos <span className="tabular-nums text-[var(--color-text-subtle)]">({diagnostic.length})</span>
          </summary>
          <ol className="mt-3 space-y-3">
            {diagnostic.slice(0, 12).map((entry) => <ActivityEvent key={entry.event.eventId} {...entry} muted />)}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function ActivityEvent({ event, presentation, muted = false }: {
  event: RunEvent;
  presentation: ReturnType<typeof eventPresentation>;
  muted?: boolean;
}): React.ReactElement {
  return (
    <li className={`flex gap-3 text-xs ${muted ? "opacity-70" : ""}`}>
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${muted ? "bg-[var(--color-text-subtle)]" : "bg-[var(--color-accent)]"}`} />
      <span>
        <strong className="block font-medium">{presentation.label}</strong>
        <small className="tabular-nums text-[var(--color-text-subtle)]">#{event.seq} · {new Date(event.at).toLocaleTimeString()}</small>
      </span>
    </li>
  );
}
