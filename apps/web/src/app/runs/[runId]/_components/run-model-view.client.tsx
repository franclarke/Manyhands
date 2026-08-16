"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleStop, PanelRightClose, PanelRightOpen, Pause, Play, RotateCcw, Send, X } from "lucide-react";

import type { AutonomyLevel } from "@manyhands/run-coordinator";

import { useLiveRunModel } from "@/components/run-model/use-live-run-model";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusPill } from "@/components/ui/status-pill";
import { autonomyDisclosure, eventDetail, eventPresentation, granularityStrategyExplanation, objectiveHeadline, planningFailureFindings, recoveryDiagnosticView, showsExecutionCounters, summarizeRunNodes, type GranularityExplanationView } from "@/lib/run-model/presentation";
import type { RunEvent, RunSeed } from "@/lib/run-model/types";
import { runUiStatus, statusMeta } from "@/lib/status";
import { CockpitRunGraph } from "./cockpit-run-graph";
import { evidenceMatrixForIdentity, isFinalCandidateDeliverable } from "./cockpit-state";
import { DecisionQueueDrawer } from "./DecisionQueueDrawer";

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
  const [mobilePane, setMobilePane] = useState<"graph" | "inspector">("graph");
  const selectedNode = model.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const pendingDecisions = model.projection === null
    ? []
    : Object.values(model.projection.decisions).filter((decision) => decision.status === "pending");
  const activeDecision = pendingDecisions.find((decision) => decision.id === decisionId) ?? null;
  const uiStatus = runUiStatus(model.run.lifecycle);
  const canDeliver = isFinalCandidateDeliverable({
    lifecycle: model.run.lifecycle,
    finalCandidate: model.projection?.finalCandidate,
    evidenceMatrices: model.evidenceMatrices
  });

  const selectedContract = useMemo(
    () => model.contracts.find((bundle) => bundle.task.nodeId === selectedNodeId) ?? null,
    [model.contracts, selectedNodeId]
  );

  const selectedGranularity = useMemo(
    () => granularityStrategyExplanation(model.projection?.granularityStrategy, selectedNodeId),
    [model.projection?.granularityStrategy, selectedNodeId]
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
    if (candidate === undefined || !canDeliver) return;
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
            {/* The title is a truncation of the goal, so printing both spends
                a line to say the same sentence twice. */}
            {model.run.goal.trim() !== model.run.title.trim() && !model.run.title.startsWith(model.run.goal.slice(0, 40))
              ? <><p className="truncate">{model.run.goal}</p><span aria-hidden className="shrink-0 text-[var(--color-text-subtle)]">·</span></>
              : null}
            <span className="shrink-0 text-[var(--color-text-subtle)]">{fixture ? "historial de muestra" : live.connected ? "sincronizado" : live.connection}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={uiStatus} label={statusMeta(uiStatus).label} />
          {!fixture ? <RunActions lifecycle={model.run.lifecycle} busy={busyAction} canDeliver={canDeliver} onCommand={command} onDeliver={() => void deliver()} /> : null}
        </div>
      </header>

      {fixtureToolbar}

      <DecisionQueueDrawer
        decisions={pendingDecisions}
        model={model}
        activeDecisionId={decisionId}
        busy={busyAction !== null}
        onOpen={openDecision}
        onClose={() => setDecisionId(null)}
        onResolve={(optionId) => void resolveDecision(optionId)}
      />

      {error !== null ? (
        <div role="alert" className="flex shrink-0 items-center justify-between border-b border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] px-6 py-2 text-xs text-[var(--status-failed-fg)]">
          <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Cerrar error"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {/* Below lg the two panes cannot share the width: a 340px inspector left
          the graph about 35px wide, so the object the whole product is about
          simply was not there. One pane at a time, graph first. */}
      <div role="tablist" aria-label="Vista del run" className="flex shrink-0 gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 lg:hidden">
        {([["graph", "Grafo"], ["inspector", "Detalle"]] as const).map(([pane, label]) => (
          <button
            key={pane}
            type="button"
            role="tab"
            aria-selected={mobilePane === pane}
            onClick={() => setMobilePane(pane)}
            className={`rounded-md px-3 py-1.5 text-label font-medium transition-colors duration-150 motion-reduce:transition-none ${mobilePane === pane ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`grid min-h-0 flex-1 grid-cols-1 transition-[grid-template-columns] duration-200 motion-reduce:transition-none ${inspectorCollapsed ? "lg:grid-cols-[minmax(0,1fr)_0px]" : "lg:grid-cols-[minmax(0,1fr)_340px]"}`}>
        <section className={`relative min-h-0 ${mobilePane === "graph" ? "" : "hidden lg:block"} ${inspectorCollapsed ? "" : "lg:border-r lg:border-[var(--color-border)]"}`}>
          <CockpitRunGraph
            model={model}
            selectedNodeId={selectedNodeId}
            pendingDecisions={pendingDecisions}
            onSelectNode={selectNode}
            onOpenDecision={openDecision}
          />
          <IconButton
            label={inspectorCollapsed ? "Mostrar panel de detalles" : "Ocultar panel de detalles"}
            aria-label={inspectorCollapsed ? "Mostrar panel de detalles" : "Ocultar panel de detalles"}
            aria-expanded={!inspectorCollapsed}
            aria-controls="run-inspector"
            onClick={() => setInspectorCollapsed((collapsed) => !collapsed)}
            className="absolute right-3 top-3 z-20 hidden h-8 w-8 border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-sm lg:flex"
          >
            {inspectorCollapsed ? <PanelRightOpen aria-hidden className="h-4 w-4" /> : <PanelRightClose aria-hidden className="h-4 w-4" />}
          </IconButton>
        </section>

        <aside id="run-inspector" aria-hidden={inspectorCollapsed} className={`min-h-0 overflow-y-auto overflow-x-hidden bg-[var(--color-surface)] ${mobilePane === "inspector" ? "" : "hidden lg:block"}`}>
          {!inspectorCollapsed ? (
            <>
              {activeDecision !== null ? (
                <DecisionDetails decision={activeDecision} nodes={model.nodes} busy={busyAction !== null} onResolve={(optionId) => void resolveDecision(optionId)} onDismiss={() => setDecisionId(null)} />
              ) : selectedNode === null ? (
                <RunSummary model={model} canDeliver={canDeliver} />
              ) : (
                <NodeDetails node={selectedNode} contract={selectedContract} granularity={selectedGranularity} onClose={() => setSelectedNodeId(null)} />
              )}
              <Activity events={model.events} />
            </>
          ) : null}
        </aside>
      </div>

    </main>
  );
}

function RunActions({ lifecycle, busy, canDeliver, onCommand, onDeliver }: { lifecycle: RunSeed["lifecycle"]; busy: string | null; canDeliver: boolean; onCommand: (path: string, body?: unknown) => Promise<void>; onDeliver: () => void }): React.ReactElement {
  return (
    <div className="flex items-center gap-1">
      {lifecycle === "running" || lifecycle === "waiting_for_input" ? <Button size="sm" busy={busy === "pause"} onClick={() => void onCommand("pause", { reason: "Pausado por el operador" })}><Pause className="h-3.5 w-3.5" />Pausar</Button> : null}
      {lifecycle === "paused" ? <Button size="sm" busy={busy === "resume"} onClick={() => void onCommand("resume", { reason: "Reanudado por el operador" })}><Play className="h-3.5 w-3.5" />Continuar</Button> : null}
      {lifecycle === "interrupted" ? <Button size="sm" busy={busy === "restart"} onClick={() => void onCommand("restart")}><RotateCcw className="h-3.5 w-3.5" />Reintentar</Button> : null}
      {lifecycle === "result_ready" ? <Button variant="primary" size="sm" busy={busy === "deliver"} disabled={!canDeliver} title={canDeliver ? undefined : "La matriz final exacta todavía no está verificada."} onClick={onDeliver}><Send className="h-3.5 w-3.5" />Publicar resultado</Button> : null}
      {["planning", "needs_approval", "running", "waiting_for_input", "paused", "result_ready"].includes(lifecycle) ? <Button variant="danger" size="icon" busy={busy === "cancel"} onClick={() => void onCommand("cancel")} aria-label="Cancelar run"><CircleStop className="h-4 w-4" /></Button> : null}
    </div>
  );
}

function RunSummary({ model, canDeliver }: { model: ReturnType<typeof useLiveRunModel>["model"]; canDeliver: boolean }): React.ReactElement {
  const summary = summarizeRunNodes(model.nodes);
  const counters = showsExecutionCounters({ graphPhase: model.graphPhase });
  return (
    <section className="border-b border-[var(--color-border)] p-5">
      <span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">Estado del objetivo</span>
      <h2 className="mt-2 text-balance text-sm font-semibold">{objectiveHeadline({
        lifecycle: model.run.lifecycle,
        graphPhase: model.graphPhase,
        nodeCount: model.nodes.length,
        executableCount: summary.executableCount,
        completedExecutables: summary.completedExecutables
      })}</h2>
      <AutonomyNotice definition={model.projection?.definition} />
      {counters ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Metric value={summary.activeAgents} label="agentes" />
            <Metric value={summary.blockedAgents} label="bloqueados" />
            <Metric value={`${summary.completedExecutables}/${summary.executableCount}`} label="resultados" />
          </div>
          <p className="mt-3 text-pretty text-micro text-[var(--color-text-subtle)]">
            {summary.coordinatingNodes > 0 ? `${summary.coordinatingNodes} nodo coordinando · ` : ""}{model.contracts.length} contrato{model.contracts.length === 1 ? "" : "s"} vigente{model.contracts.length === 1 ? "" : "s"}
          </p>
        </>
      ) : null}
      {canDeliver ? <div className="mt-4 rounded-lg border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] p-3 text-xs text-[var(--status-completed-fg)]"><CheckCircle2 className="mr-2 inline h-4 w-4" />Resultado verificado listo para publicar.</div> : null}
      {model.run.lifecycle === "result_ready" && model.projection?.finalCandidate !== undefined && !canDeliver ? <div className="mt-4 rounded-lg border border-[var(--status-review-border)] bg-[var(--status-review-bg)] p-3 text-xs text-[var(--status-review-fg)]">La entrega está bloqueada hasta verificar la matriz exacta del candidato.</div> : null}
      <EvidenceDetails matrices={model.evidenceMatrices} matrixId={model.projection?.finalCandidate?.evidenceMatrixId} candidateCommit={model.projection?.finalCandidate?.commit} />
      <RecoveryFailure projection={model.projection} />
      <FailureFindings projection={model.projection} />
    </section>
  );
}

/**
 * One entry per finding. A failed plan used to arrive as seven of them joined
 * with " | " inside a single red block, so the operator read a paragraph to
 * learn which of seven things went wrong.
 */
/**
 * A recovery failure with its own evidence, in place of the sentence.
 *
 * The diagnostic's headline says what the reason said, and the identifiers sit
 * beside it as fields — a diverged ref reads as three values a person can act
 * on rather than one line they have to parse. `FailureFindings` steps aside
 * when this renders so the same sentence is not printed twice.
 */
function RecoveryFailure({ projection }: { projection: ReturnType<typeof useLiveRunModel>["model"]["projection"] }): React.ReactElement | null {
  const view = recoveryDiagnosticView({
    ...(projection?.recoveryDiagnostic === undefined ? {} : { recoveryDiagnostic: projection.recoveryDiagnostic })
  });
  if (view === null) return null;
  return (
    <section className="mt-4 rounded-lg border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] p-3">
      <h3 className="text-pretty text-xs font-semibold text-[var(--status-failed-fg)]">{view.headline}</h3>
      <dl className="mt-2 grid gap-1.5 text-xs text-[var(--status-failed-fg)]">
        {view.evidence.map((item) => (
          <div key={item.label} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="shrink-0 opacity-80">{item.label}</dt>
            <dd className="mh-mono min-w-0 break-all">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FailureFindings({ projection }: { projection: ReturnType<typeof useLiveRunModel>["model"]["projection"] }): React.ReactElement | null {
  // The diagnostic block already carries this run's reason, field by field.
  if (projection?.recoveryDiagnostic !== undefined) return null;
  const findings = planningFailureFindings({
    ...(projection?.failureReason === undefined ? {} : { failureReason: projection.failureReason }),
    ...(projection?.planningFindings === undefined ? {} : { planningFindings: projection.planningFindings })
  });
  if (findings.length === 0) return null;
  return (
    <section className="mt-4 rounded-lg border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] p-3">
      <h3 className="text-xs font-semibold text-[var(--status-failed-fg)]">
        {findings.length === 1 ? "El run se detuvo por este motivo" : `El run se detuvo por ${findings.length} motivos`}
      </h3>
      <ul className="mt-2 space-y-2">
        {findings.map((finding, index) => (
          <li key={`${finding.code ?? "reason"}:${index}`} className="text-xs text-[var(--status-failed-fg)]">
            {finding.code !== undefined ? (
              <span className="mh-mono block text-eyebrow uppercase tracking-[0.08em] opacity-80">{finding.code}</span>
            ) : null}
            <p className="text-pretty">{finding.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceDetails({ matrices, matrixId, candidateCommit }: { matrices: readonly Record<string, unknown>[]; matrixId?: string | undefined; candidateCommit?: string | undefined }): React.ReactElement | null {
  const matrix = evidenceMatrixForIdentity(matrices, { matrixId, candidateCommit });
  if (matrix === undefined) return null;
  const criteria = Array.isArray(matrix.criteria) ? matrix.criteria.filter(isRecord) : [];
  const outcome = typeof matrix.outcome === "string" ? matrix.outcome : "pending";
  return (
    <section className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <strong>Matriz de evidencia</strong>
        <span className="mh-mono uppercase text-[var(--color-text-muted)]">{outcome}</span>
      </div>
      <ul className="mt-3 space-y-2">
        {criteria.map((criterion, index) => {
          const evidenceRefs = Array.isArray(criterion.evidenceRefs)
            ? criterion.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
            : [];
          return (
            <li key={typeof criterion.criterionId === "string" ? criterion.criterionId : index} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span>{typeof criterion.criterionId === "string" ? criterion.criterionId : `Criterio ${index + 1}`}</span>
                <strong>{typeof criterion.status === "string" ? criterion.status : "pending"}</strong>
              </div>
              {typeof criterion.justification === "string" ? <p className="mt-1 text-[var(--color-text-muted)]">{criterion.justification}</p> : null}
              {evidenceRefs.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer select-none text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    {describeEvidenceRefs(evidenceRefs)}
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {evidenceRefs.map((ref) => <li key={ref} className="mh-mono break-all text-eyebrow text-[var(--color-text-subtle)]">{ref}</li>)}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * What the evidence is, not its digest. `command-bfd5b36f…:attempt:1` is the
 * identity of a validation run; it is not a sentence anyone can read, and the
 * digest is only useful once someone has decided to check it.
 */
function describeEvidenceRefs(refs: readonly string[]): string {
  const commands = refs.filter((ref) => ref.startsWith("command-")).length;
  const controls = refs.filter((ref) => ref.includes("negative-control")).length;
  const rest = refs.length - commands - controls;
  const parts = [
    commands === 0 ? null : `${commands} comando${commands === 1 ? "" : "s"} ejecutado${commands === 1 ? "" : "s"}`,
    controls === 0 ? null : `${controls} control negativo`,
    rest <= 0 ? null : `${rest} referencia${rest === 1 ? "" : "s"}`
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? `${refs.length} referencias` : parts.join(" · ");
}

function Metric({ value, label }: { value: number | string; label: string }): React.ReactElement { return <div className="rounded-lg bg-[var(--color-bg-subtle)] p-2"><strong className="block text-base tabular-nums">{value}</strong><span className="text-eyebrow text-[var(--color-text-subtle)]">{label}</span></div>; }

function DecisionDetails({ decision, nodes, busy, onResolve, onDismiss }: { decision: NonNullable<ReturnType<typeof useLiveRunModel>["model"]["projection"]>["decisions"][string]; nodes: ReturnType<typeof useLiveRunModel>["model"]["nodes"]; busy: boolean; onResolve: (optionId: string) => void; onDismiss: () => void }): React.ReactElement {
  const affectedLabel = affectedNodeLabel(decision.affectedNodeIds, nodes);
  return (
    <section className="border-b border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between gap-4"><div><span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--status-review-fg)]">Decisión requerida</span><h2 className="mt-1 text-base font-semibold">{affectedLabel}</h2></div><button type="button" onClick={onDismiss} aria-label="Cerrar decisiones" className="rounded-md p-1 text-[var(--color-text-muted)] transition-colors motion-reduce:transition-none hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"><X className="h-4 w-4" /></button></div>
      <div className="mt-4 rounded-lg border border-[var(--status-review-border)] bg-[var(--status-review-bg)] p-3">
        <span className="block text-eyebrow font-semibold uppercase tracking-[0.1em] text-[var(--status-review-fg)]">Qué necesita resolución</span>
        <p className="mt-1.5 text-xs leading-5 text-[var(--color-text)]">{decisionReason(decision.question, nodes, decision.affectedNodeIds)}</p>
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">Esta respuesta se aplica a {decision.affectedNodeIds.length === 1 ? "este nodo" : "estos nodos"}; las ramas independientes siguen su curso.</p>
      <div className="mt-5"><span className="mh-mono block text-eyebrow uppercase tracking-[0.11em] text-[var(--color-text-subtle)]">Elegí una acción</span><div className="mt-2 grid gap-2">
        {decision.options.map((option, index) => (
          <button key={option.id} type="button" disabled={busy} onClick={() => onResolve(option.id)} className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 text-left transition-[border-color,background-color,transform] duration-200 motion-reduce:transform-none motion-reduce:transition-none hover:-translate-y-px hover:border-[var(--status-review-fg)] hover:bg-[var(--color-surface-raised)] disabled:cursor-wait disabled:opacity-60">
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

function NodeDetails({ node, contract, granularity, onClose }: { node: ReturnType<typeof useLiveRunModel>["model"]["nodes"][number]; contract: ReturnType<typeof useLiveRunModel>["model"]["contracts"][number] | null; granularity: GranularityExplanationView | null; onClose: () => void }): React.ReactElement {
  return (
    <section className="border-b border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between gap-4"><div><span className="mh-mono text-eyebrow uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">{node.kind}</span><h2 className="mt-1 text-sm font-semibold">{node.title}</h2></div><button type="button" onClick={onClose} aria-label="Cerrar detalle"><X className="h-4 w-4" /></button></div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">{node.goal}</p>
      {granularity !== null ? <GranularityDetails granularity={granularity} /> : null}
      {contract !== null ? <div className="mt-5 space-y-4 text-xs"><Detail label="Alcance" value={`${contract.scope.allowedPaths.length} rutas permitidas`} /><Detail label="Criterios" value={`${contract.task.acceptanceCriteria.length} condiciones verificables`} /><Detail label="Entradas / salidas" value={`${contract.task.consumes.length} / ${contract.task.produces.length}`} /><div><span className="mb-2 block text-eyebrow uppercase tracking-wide text-[var(--color-text-subtle)]">Aceptación</span><ul className="space-y-1.5">{contract.task.acceptanceCriteria.map((criterion) => <li key={criterion.id} className="rounded bg-[var(--color-bg-subtle)] p-2">{criterion.description}</li>)}</ul></div></div> : <p className="mt-4 text-xs text-[var(--color-text-subtle)]">Este nodo agrupa trabajo; sus contratos viven en los nodos ejecutables.</p>}
    </section>
  );
}

/** Explains why the policy made this node one unit or a cut, reason by reason. */
function GranularityDetails({ granularity }: { granularity: GranularityExplanationView }): React.ReactElement {
  const carried = granularity.reasons.filter((reason) => reason.holds).length;
  return (
    <details className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 text-xs">
      <summary className="cursor-pointer select-none font-medium">
        Granularidad: {granularity.decisionLabel}{" "}
        <span className="tabular-nums text-[var(--color-text-muted)]">
          ({carried} de {granularity.reasons.length} razones)
        </span>
      </summary>
      <ul className="mt-3 space-y-2">
        {granularity.reasons.map((reason) => (
          <li key={reason.label} className="flex items-baseline gap-2">
            <span aria-hidden="true" className={reason.holds ? "text-[var(--color-text)]" : "text-[var(--color-text-subtle)]"}>
              {reason.holds ? "✓" : "–"}
            </span>
            <span>
              <span className={reason.holds ? "font-medium" : "text-[var(--color-text-muted)]"}>
                {reason.label}
              </span>
              <span className="sr-only">{reason.holds ? " (aplica)" : " (no aplica)"}</span>
              <span className="block leading-5 text-[var(--color-text-subtle)]">{reason.explanation}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 leading-5 text-[var(--color-text-muted)]">{granularity.rationale}</p>
      {granularity.evidenceRefs.length === 0 ? null : <p className="mt-2 break-all text-[var(--color-text-subtle)]">Evidencia: {granularity.evidenceRefs.join(", ")}</p>}
      <p className="mt-3 text-[var(--color-text-subtle)]">Política {granularity.policyVersion}</p>
    </details>
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

/**
 * The standing authorization the run is acting under.
 *
 * Without it, a run that approved its own plan and published its own result is
 * indistinguishable from one whose operator was very fast. Absent when nothing
 * was delegated, because then there is nothing to disclose.
 */
function AutonomyNotice({ definition }: { definition?: { autonomy?: AutonomyLevel | undefined } | undefined }): React.ReactElement | null {
  const disclosure = autonomyDisclosure(definition);
  if (disclosure === null) return null;
  return (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-micro text-[var(--color-text-muted)]">
      <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 font-medium text-[var(--color-text)]">
        Autonomía · {disclosure.label}
      </span>
      <span className="text-pretty">{disclosure.scope}</span>
    </p>
  );
}

function ActivityEvent({ event, presentation, muted = false }: {
  event: RunEvent;
  presentation: ReturnType<typeof eventPresentation>;
  muted?: boolean;
}): React.ReactElement {
  const detail = eventDetail(event);
  return (
    <li className={`flex gap-3 text-xs ${muted ? "opacity-70" : ""}`}>
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${muted ? "bg-[var(--color-text-subtle)]" : "bg-[var(--color-accent)]"}`} />
      <span>
        <strong className="block font-medium">{presentation.label}</strong>
        {detail === null ? null : <span className="block text-[var(--color-text-muted)]">{detail}</span>}
        <small className="tabular-nums text-[var(--color-text-subtle)]">#{event.seq} · {new Date(event.at).toLocaleTimeString()}</small>
      </span>
    </li>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
