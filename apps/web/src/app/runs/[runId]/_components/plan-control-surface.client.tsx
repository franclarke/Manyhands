"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  GitBranch,
  GitFork,
  Loader2,
  Play,
  RefreshCcw,
  Save,
  ShieldCheck,
  Split
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CapabilitiesResponse } from "@/lib/api-types";
import type { PlanControlNode, PlanControlPlane } from "@/lib/plan-control";
import type { PlanReviewSummary } from "@/lib/plan-review";
import type { FocusTarget } from "@/lib/run-model/focus-view";
import type { RunModel } from "@/lib/run-model/types";

type ControlTab = "quality" | "task" | "structure" | "operations";

interface PlanReviewResponse {
  planReview: PlanReviewSummary | null;
  controlPlane: PlanControlPlane | null;
}

interface NodeDraft {
  title: string;
  objective: string;
  allowedPaths: string;
  forbiddenPaths: string;
  acceptanceCriteria: string;
  manual: boolean;
  executorSelection: string;
}

const TAB_LABELS: Record<ControlTab, string> = {
  quality: "Calidad",
  task: "Tarea",
  structure: "Estructura",
  operations: "Operaciones"
};

export function PlanControlSurface({
  runId,
  model,
  focus,
  onFocus
}: {
  runId: string;
  model: RunModel;
  focus: FocusTarget | null;
  onFocus: (target: FocusTarget | null) => void;
}): React.ReactElement {
  const [payload, setPayload] = useState<PlanReviewResponse | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<ControlTab>("quality");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      fetch(`/api/runs/${encodeURIComponent(runId)}/plan-review`, { signal: controller.signal }).then((response) => readJson<PlanReviewResponse>(response)),
      fetch("/api/capabilities", { signal: controller.signal }).then((response) => readJson<CapabilitiesResponse>(response))
    ])
      .then(([plan, capabilityPayload]) => {
        setPayload(plan);
        setCapabilities(capabilityPayload);
        setError(null);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [model.run.control.version, refreshKey, runId]);

  const control = payload?.controlPlane ?? null;
  const focusedNodeId = focus?.kind === "node" ? focus.id : undefined;
  const [selectedNodeId, setSelectedNodeId] = useState(focusedNodeId ?? "");

  useEffect(() => {
    if (focusedNodeId !== undefined) setSelectedNodeId(focusedNodeId);
  }, [focusedNodeId]);
  useEffect(() => {
    if (control !== null && !control.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(control.nodes[0]?.id ?? "");
    }
  }, [control, selectedNodeId]);

  const selectedNode = control?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  async function mutate(
    key: string,
    path: string,
    init: RequestInit,
    options: { reload?: boolean; success: string; navigateToRun?: boolean }
  ): Promise<void> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await fetch(path, init).then((response) => readJson<Record<string, unknown>>(response));
      if (options.navigateToRun === true) {
        const newRunId = typeof result.newRunId === "string" ? result.newRunId : undefined;
        if (newRunId === undefined) throw new Error("El fork no devolvió el identificador del nuevo run.");
        window.location.assign(`/runs/${encodeURIComponent(newRunId)}`);
        return;
      }
      setNotice(options.success);
      if (options.reload === true) {
        window.location.reload();
      } else {
        setRefreshKey((current) => current + 1);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  if (loading && payload === null) {
    return <SurfaceState icon={<Loader2 className="h-4 w-4 animate-spin" />} title="Cargando plano de control" detail="Leyendo la revisión y el DAG persistido…" />;
  }
  if (payload === null || control === null) {
    return <SurfaceState icon={<AlertTriangle className="h-4 w-4" />} title="Plan no disponible" detail={error ?? "Este run todavía no tiene un DAG editable."} />;
  }

  return (
    <div className="grid gap-3 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold text-[var(--color-text)]">Control del plan</h3>
            <p className="mh-mono m-0 mt-0.5 text-eyebrow text-[var(--color-text-subtle)]">
              v{control.version} · {control.status} · {control.nodes.length} tareas
            </p>
          </div>
        </div>
        <span className={control.editable ? "text-eyebrow text-[var(--status-completed-fg)]" : "text-eyebrow text-[var(--color-text-subtle)]"}>
          {control.editable ? "Editable" : "Solo lectura"}
        </span>
      </header>

      <div role="tablist" aria-label="Secciones del control del plan" className="grid grid-cols-4 gap-1 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-1">
        {(Object.keys(TAB_LABELS) as ControlTab[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={tab === id
              ? "h-7 rounded-[var(--r-sm)] border-0 bg-[var(--color-surface-raised)] px-1 text-eyebrow font-semibold text-[var(--color-text)]"
              : "h-7 rounded-[var(--r-sm)] border-0 bg-transparent px-1 text-eyebrow text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {error !== null ? <Feedback tone="bad">{error}</Feedback> : null}
      {notice !== null ? <Feedback tone="good">{notice}</Feedback> : null}

      {tab === "quality" ? (
        <QualityTab
          summary={payload.planReview}
          control={control}
          busy={busy}
          onFocus={(nodeId) => {
            setSelectedNodeId(nodeId);
            setTab("task");
            onFocus({ kind: "node", id: nodeId });
          }}
          onAcknowledge={(taskIds) => void mutate(
            `risk:${taskIds.join(":")}`,
            `/api/runs/${encodeURIComponent(runId)}/risks/acknowledge`,
            jsonRequest("POST", { taskIds }),
            { reload: true, success: "Riesgo reconocido." }
          )}
          onAutoResolve={() => void mutate(
            "auto-resolve",
            `/api/runs/${encodeURIComponent(runId)}/auto-resolve`,
            { method: "POST" },
            { reload: true, success: "Riesgos reconocidos." }
          )}
        />
      ) : null}

      {tab === "task" ? (
        <TaskTab
          runId={runId}
          node={selectedNode}
          nodes={control.nodes}
          version={control.version}
          editable={control.editable}
          canRunManualNodes={control.canRunManualNodes}
          runStatus={control.status}
          routing={control.routing}
          capabilities={capabilities}
          busy={busy}
          onSelect={(nodeId) => {
            setSelectedNodeId(nodeId);
            onFocus({ kind: "node", id: nodeId });
          }}
          onMutate={mutate}
        />
      ) : null}

      {tab === "structure" ? (
        <StructureTab runId={runId} control={control} busy={busy} onMutate={mutate} />
      ) : null}

      {tab === "operations" ? (
        <OperationsTab runId={runId} control={control} busy={busy} onMutate={mutate} />
      ) : null}
    </div>
  );
}

function QualityTab({
  summary,
  control,
  busy,
  onFocus,
  onAcknowledge,
  onAutoResolve
}: {
  summary: PlanReviewSummary | null;
  control: PlanControlPlane;
  busy: string | null;
  onFocus: (nodeId: string) => void;
  onAcknowledge: (taskIds: [string, string]) => void;
  onAutoResolve: () => void;
}): React.ReactElement {
  const actionableRisks = control.risks.filter((risk) => risk.level === "high" || risk.level === "blocking");
  const nonRiskIssues = summary?.issues.filter((issue) => issue.kind !== "risk") ?? [];
  if (summary === null) return <SurfaceState icon={<CircleDot className="h-4 w-4" />} title="Sin revisión" detail="El plan todavía no tiene una revisión materializada." />;
  return (
    <div className="grid gap-4">
      <section aria-labelledby="plan-readiness-title">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 id="plan-readiness-title" className="m-0 text-xs font-semibold text-[var(--color-text)]">Preparación ejecutable</h4>
          <span className={summary.status === "clean" ? "text-eyebrow text-[var(--status-completed-fg)]" : "text-eyebrow text-[var(--status-review-fg)]"}>
            {summary.issueCounts.errors} errores · {summary.issueCounts.warnings} alertas
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-border)]">
          <Metric label="Contratos" value={`${summary.readiness.contractReadyLeaves}/${summary.readiness.totalLeaves}`} />
          <Metric label="Scopes" value={`${summary.readiness.scopeReadyLeaves}/${summary.readiness.totalLeaves}`} />
          <Metric label="Aceptación" value={`${summary.readiness.acceptanceReadyLeaves}/${summary.readiness.totalLeaves}`} />
          <Metric label="Outputs" value={`${summary.readiness.expectedOutputReadyLeaves}/${summary.readiness.totalLeaves}`} />
        </div>
      </section>

      <section aria-labelledby="plan-issues-title" className="space-y-1.5">
        <h4 id="plan-issues-title" className="m-0 text-xs font-semibold text-[var(--color-text)]">Hallazgos</h4>
        {nonRiskIssues.length === 0 ? <p className="m-0 text-xs text-[var(--status-completed-fg)]">No hay problemas de estructura, contratos o interfaces.</p> : null}
        {nonRiskIssues.map((issue, index) => (
          <button
            key={`${issue.kind}-${issue.taskId ?? "global"}-${index}`}
            type="button"
            disabled={issue.taskId === undefined}
            onClick={() => issue.taskId !== undefined && onFocus(issue.taskId)}
            className="block w-full rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left disabled:cursor-default"
          >
            <span className={issue.severity === "error" ? "text-xs font-semibold text-[var(--status-failed-fg)]" : "text-xs font-semibold text-[var(--status-review-fg)]"}>{issue.title}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-muted)]">{issue.detail}</span>
          </button>
        ))}
      </section>

      <section aria-labelledby="plan-risks-title" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 id="plan-risks-title" className="m-0 text-xs font-semibold text-[var(--color-text)]">Riesgos de coordinación</h4>
          {control.editable && actionableRisks.some((risk) => !risk.acknowledged) ? (
            <Button variant="quiet" size="sm" busy={busy === "auto-resolve"} onClick={onAutoResolve}>Reconocer todos</Button>
          ) : null}
        </div>
        {actionableRisks.length === 0 ? <p className="m-0 text-xs text-[var(--color-text-subtle)]">Sin riesgos altos o bloqueantes.</p> : null}
        {actionableRisks.map((risk) => (
          <div key={risk.taskIds.join("::")} className="rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-[var(--color-text)]">{risk.level === "blocking" ? "Bloqueante" : "Alto"} · {Math.round(risk.score * 100)}%</strong>
              {risk.acknowledged ? <span className="text-eyebrow text-[var(--status-completed-fg)]">Reconocido</span> : null}
            </div>
            <p className="m-0 mt-1 leading-relaxed text-[var(--color-text-muted)]">
              {risk.taskIds.map((taskId) => control.nodes.find((node) => node.id === taskId)?.title ?? taskId).join(" ↔ ")}
            </p>
            <p className="m-0 mt-1 text-eyebrow text-[var(--status-review-fg)]">{riskRecommendationLabel(risk.recommendation)}</p>
            {risk.sharedFiles.length > 0 ? (
              <p className="mh-mono m-0 mt-1 break-all text-eyebrow text-[var(--color-text-subtle)]">
                {risk.sharedFiles.slice(0, 3).join(" · ")}{risk.sharedFiles.length > 3 ? ` · +${risk.sharedFiles.length - 3}` : ""}
              </p>
            ) : null}
            <details className="mt-2 text-[var(--color-text-muted)]">
              <summary className="cursor-pointer select-none text-eyebrow text-[var(--color-text-subtle)]">Ver evidencia</summary>
              <p className="m-0 mt-1 leading-relaxed">{risk.explanation}</p>
            </details>
            {!risk.acknowledged && control.editable ? (
              <Button className="mt-2" variant="ghost" size="sm" busy={busy === `risk:${risk.taskIds.join(":")}`} onClick={() => onAcknowledge(risk.taskIds)}>
                Reconocer riesgo
              </Button>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}

function TaskTab({
  runId,
  node,
  nodes,
  version,
  editable,
  canRunManualNodes,
  runStatus,
  routing,
  capabilities,
  busy,
  onSelect,
  onMutate
}: {
  runId: string;
  node: PlanControlNode | null;
  nodes: PlanControlNode[];
  version: number;
  editable: boolean;
  canRunManualNodes: boolean;
  runStatus: PlanControlPlane["status"];
  routing: PlanControlPlane["routing"];
  capabilities: CapabilitiesResponse | null;
  busy: string | null;
  onSelect: (nodeId: string) => void;
  onMutate: PlanMutation;
}): React.ReactElement {
  const [draft, setDraft] = useState<NodeDraft | null>(node === null ? null : nodeDraft(node));
  const [feedback, setFeedback] = useState("");
  const [confirmRegen, setConfirmRegen] = useState(false);
  useEffect(() => {
    setDraft(node === null ? null : nodeDraft(node));
    setFeedback("");
    setConfirmRegen(false);
  }, [node]);
  const executionModels = useMemo(
    () => capabilities?.executors.flatMap((executor) => executor.models
      .filter((model) => model.capabilities.includes("execution"))
      .map((model) => ({ value: `${executor.executorId}/${model.id}`, label: `${executor.label} · ${model.label}`, enabled: executor.enabled && executor.readiness.status !== "error" }))) ?? [],
    [capabilities]
  );
  if (node === null || draft === null) return <SurfaceState icon={<CircleDot className="h-4 w-4" />} title="Sin tarea" detail="Seleccioná una tarea del DAG para revisar su contrato." />;

  const activeNode = node;
  const activeDraft = draft;
  const contractual = activeNode.kind === "leaf" || activeNode.kind === "integrator";
  const individuallyExecutable = activeNode.kind === "leaf" || activeNode.kind === "integrator";
  const reviewVisible = runStatus === "approved" || runStatus === "completed" || runStatus === "completed_with_accepted" || runStatus === "failed";
  const reworkAllowed = runStatus === "approved" || runStatus === "completed" || runStatus === "completed_with_accepted" || runStatus === "failed";
  const changed = JSON.stringify(activeDraft) !== JSON.stringify(nodeDraft(activeNode));

  function save(): void {
    const original = nodeDraft(activeNode);
    const body: Record<string, unknown> = { expectedVersion: version };
    if (activeDraft.title !== original.title) body.title = activeDraft.title.trim();
    if (activeDraft.objective !== original.objective) body.objective = activeDraft.objective.trim();
    if (activeDraft.allowedPaths !== original.allowedPaths) body.allowedPaths = lines(activeDraft.allowedPaths);
    if (activeDraft.forbiddenPaths !== original.forbiddenPaths) body.forbiddenPaths = lines(activeDraft.forbiddenPaths);
    if (activeDraft.acceptanceCriteria !== original.acceptanceCriteria) body.acceptanceCriteria = lines(activeDraft.acceptanceCriteria);
    if (activeDraft.manual !== original.manual) body.manual = activeDraft.manual;
    if (activeDraft.executorSelection !== original.executorSelection) {
      body.executorSelection = activeDraft.executorSelection.length === 0 ? null : selectionFromValue(activeDraft.executorSelection);
    }
    void onMutate(
      "save-node",
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(activeNode.id)}`,
      jsonRequest("PATCH", body),
      { reload: true, success: "Tarea actualizada." }
    );
  }

  return (
    <div className="grid gap-4">
      <label className="grid gap-1 text-xs font-medium text-[var(--color-text-muted)]">
        Tarea
        <select className="mh-select h-8 text-meta" value={node.id} onChange={(event) => onSelect(event.target.value)}>
          {nodes.map((entry) => <option key={entry.id} value={entry.id}>{entry.title} · {entry.kind}</option>)}
        </select>
      </label>

      <fieldset disabled={!editable || busy !== null} className="m-0 grid min-w-0 gap-3 border-0 p-0 disabled:opacity-65">
        <TextField label="Título" value={draft.title} onChange={(value) => setDraft({ ...draft, title: value })} />
        <TextArea label="Objetivo" value={draft.objective} rows={4} onChange={(value) => setDraft({ ...draft, objective: value })} />
        {contractual ? (
          <>
            <TextArea label="Paths permitidos · uno por línea" value={draft.allowedPaths} rows={3} mono onChange={(value) => setDraft({ ...draft, allowedPaths: value })} />
            <TextArea label="Paths prohibidos · uno por línea" value={draft.forbiddenPaths} rows={3} mono onChange={(value) => setDraft({ ...draft, forbiddenPaths: value })} />
            <TextArea label="Criterios de aceptación · uno por línea" value={draft.acceptanceCriteria} rows={4} onChange={(value) => setDraft({ ...draft, acceptanceCriteria: value })} />
            {routing === "complexity" ? (
              <label className="grid gap-1 text-xs font-medium text-[var(--color-text-muted)]">
                Executor de esta tarea
                <select className="mh-select h-8 text-meta" value={draft.executorSelection} onChange={(event) => setDraft({ ...draft, executorSelection: event.target.value })}>
                  <option value="">Heredar configuración del run</option>
                  {executionModels.map((model) => <option key={model.value} value={model.value} disabled={!model.enabled}>{model.label}{model.enabled ? "" : " · no disponible"}</option>)}
                </select>
              </label>
            ) : (
              <div className="rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
                Este run usa routing fijo: todas las tareas heredan el executor configurado para el run.
                {activeNode.executorSelection !== null ? (
                  <Button className="mt-2" variant="quiet" size="sm" onClick={() => setDraft({ ...draft, executorSelection: "" })}>
                    Quitar override legacy
                  </Button>
                ) : null}
              </div>
            )}
          </>
        ) : null}
        {individuallyExecutable ? (
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <input type="checkbox" checked={draft.manual} onChange={(event) => setDraft({ ...draft, manual: event.target.checked })} />
            Ejecución manual controlada
          </label>
        ) : (
          <p className="m-0 text-xs leading-relaxed text-[var(--color-text-subtle)]">
            {activeNode.kind === "root" ? "La raíz coordina el run completo y no se despacha como tarea individual." : "Esta tarea compuesta se ejecuta a través de sus tareas hijas."}
          </p>
        )}
        <Button variant="primary" size="sm" disabled={!changed || draft.title.trim().length === 0 || draft.objective.trim().length === 0} busy={busy === "save-node"} onClick={save}>
          <Save aria-hidden className="h-4 w-4" /> Guardar cambios
        </Button>
      </fieldset>

      <section className="border-t border-[var(--color-border)] pt-3">
        <h4 className="m-0 text-xs font-semibold text-[var(--color-text)]">Regeneración</h4>
        <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">Reemplaza esta rama usando el planificador configurado y vuelve a requerir aprobación.</p>
        {confirmRegen ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="danger" size="sm" busy={busy === "regen"} onClick={() => void onMutate("regen", `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.id)}/regen`, jsonRequest("POST", {}), { reload: true, success: "Rama regenerada." })}>
              Confirmar regeneración
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setConfirmRegen(false)}>Cancelar</Button>
          </div>
        ) : (
          <Button className="mt-2" variant="ghost" size="sm" disabled={!editable} onClick={() => setConfirmRegen(true)}>
            <RefreshCcw aria-hidden className="h-4 w-4" /> Regenerar rama
          </Button>
        )}
      </section>

      {reviewVisible ? <section className="border-t border-[var(--color-border)] pt-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="m-0 text-xs font-semibold text-[var(--color-text)]">Ejecución y review</h4>
          {node.review !== null ? <span className="text-eyebrow text-[var(--color-text-subtle)]">{node.review.status}</span> : null}
        </div>
        {individuallyExecutable && node.manual ? (
          <Button className="mt-2" variant="primary" size="sm" disabled={!canRunManualNodes} busy={busy === "run-node"} onClick={() => void onMutate("run-node", `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.id)}/run`, { method: "POST" }, { success: "Ejecución iniciada." })}>
            <Play aria-hidden className="h-4 w-4" /> Ejecutar tarea
          </Button>
        ) : individuallyExecutable ? <p className="m-0 mt-1 text-xs text-[var(--color-text-subtle)]">Marcá la tarea como manual para despacharla individualmente.</p> : null}
        <TextArea label="Feedback opcional" value={feedback} rows={3} onChange={setFeedback} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" busy={busy === "review-approve"} onClick={() => void onMutate("review-approve", `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.id)}/review`, jsonRequest("POST", { action: "approve", ...(feedback.trim().length > 0 ? { feedback: feedback.trim() } : {}) }), { success: "Resultado aprobado." })}>
            <CheckCircle2 aria-hidden className="h-4 w-4" /> Aprobar
          </Button>
          <Button variant="ghost" size="sm" disabled={!reworkAllowed} busy={busy === "review-changes"} onClick={() => void onMutate("review-changes", `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.id)}/review`, jsonRequest("POST", { action: "request_changes", ...(feedback.trim().length > 0 ? { feedback: feedback.trim() } : {}) }), { reload: true, success: "Cambios solicitados." })}>
            Pedir cambios
          </Button>
          <Button variant="ghost" size="sm" disabled={!reworkAllowed} busy={busy === "review-rerun"} onClick={() => void onMutate("review-rerun", `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.id)}/review`, jsonRequest("POST", { action: "rerun", ...(feedback.trim().length > 0 ? { feedback: feedback.trim() } : {}) }), { success: "Reejecución iniciada." })}>
            Reejecutar
          </Button>
        </div>
      </section> : null}
    </div>
  );
}

function StructureTab({ runId, control, busy, onMutate }: { runId: string; control: PlanControlPlane; busy: string | null; onMutate: PlanMutation }): React.ReactElement {
  const dependencyNodes = control.nodes.filter((node) => node.kind !== "root");
  const [fromTaskId, setFromTaskId] = useState(dependencyNodes[0]?.id ?? "");
  const [toTaskId, setToTaskId] = useState(dependencyNodes[1]?.id ?? "");
  const [rationale, setRationale] = useState("");
  const [integrates, setIntegrates] = useState<string[]>([]);
  const [integratorTitle, setIntegratorTitle] = useState("");
  const [integratorReason, setIntegratorReason] = useState("");
  return (
    <div className="grid gap-4">
      <section>
        <h4 className="m-0 text-xs font-semibold text-[var(--color-text)]">Serializar tareas</h4>
        <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
          Agrega una barrera de orden al DAG; no crea una wave ni modifica la jerarquía. La tarea dependiente parte del mismo commit base y no recibe los archivos de la tarea anterior. Si necesita esos archivos concretos, reuní el trabajo en una tarea o definí un sharedInterface explícito.
        </p>
        <div className="mt-2 grid gap-2">
          <NodeSelect label="Desde" nodes={dependencyNodes} value={fromTaskId} onChange={setFromTaskId} />
          <NodeSelect label="Hacia" nodes={dependencyNodes} value={toTaskId} onChange={setToTaskId} />
          <TextField label="Rationale opcional" value={rationale} onChange={setRationale} />
          <Button variant="primary" size="sm" disabled={!control.editable || fromTaskId === toTaskId} busy={busy === "serialize"} onClick={() => void onMutate("serialize", `/api/runs/${encodeURIComponent(runId)}/serialize`, jsonRequest("POST", { fromTaskId, toTaskId, ...(rationale.trim().length > 0 ? { rationale: rationale.trim() } : {}) }), { reload: true, success: "Dependencia agregada." })}>
            <Split aria-hidden className="h-4 w-4" /> Agregar dependencia
          </Button>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] pt-3">
        <h4 className="m-0 text-xs font-semibold text-[var(--color-text)]">Dependencias actuales</h4>
        <div className="mt-2 space-y-1.5">
          {control.dependencies.length === 0 ? <p className="m-0 text-xs text-[var(--color-text-subtle)]">El DAG no tiene dependencias explícitas.</p> : null}
          {control.dependencies.map((dependency) => (
            <div key={`${dependency.fromTaskId}->${dependency.toTaskId}`} className="flex items-start justify-between gap-2 rounded-[var(--r-sm)] border border-[var(--color-border)] px-3 py-2">
              <div className="min-w-0">
                <p className="m-0 truncate text-xs text-[var(--color-text)]">
                  {control.nodes.find((node) => node.id === dependency.fromTaskId)?.title ?? dependency.fromTaskId} → {control.nodes.find((node) => node.id === dependency.toTaskId)?.title ?? dependency.toTaskId}
                </p>
                <p className="m-0 mt-0.5 text-eyebrow text-[var(--color-text-subtle)]">{dependency.type}{dependency.inferred ? " · inferida" : ""}</p>
              </div>
              <Button variant="quiet" size="sm" disabled={!control.editable} busy={busy === `remove:${dependency.fromTaskId}:${dependency.toTaskId}`} onClick={() => void onMutate(`remove:${dependency.fromTaskId}:${dependency.toTaskId}`, `/api/runs/${encodeURIComponent(runId)}/dependencies`, jsonRequest("DELETE", { fromTaskId: dependency.fromTaskId, toTaskId: dependency.toTaskId }), { reload: true, success: "Dependencia eliminada." })}>Eliminar</Button>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] pt-3">
        <h4 className="m-0 text-xs font-semibold text-[var(--color-text)]">Crear tarea integradora</h4>
        <p className="m-0 mt-1 text-xs text-[var(--color-text-muted)]">Crea una tarea real que integra los resultados seleccionados.</p>
        <label className="mt-2 grid gap-1 text-xs font-medium text-[var(--color-text-muted)]">
          Tareas a integrar
          <select multiple size={Math.min(6, Math.max(3, control.nodes.length))} className="mh-select min-h-24 py-1 text-meta" value={integrates} onChange={(event) => setIntegrates(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
            {control.nodes.filter((node) => node.kind !== "root").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
          </select>
        </label>
        <div className="mt-2 grid gap-2">
          <TextField label="Título opcional" value={integratorTitle} onChange={setIntegratorTitle} />
          <TextArea label="Motivo" value={integratorReason} rows={3} onChange={setIntegratorReason} />
          <Button variant="primary" size="sm" disabled={!control.editable || integrates.length < 2 || integratorReason.trim().length === 0} busy={busy === "integrator"} onClick={() => void onMutate("integrator", `/api/runs/${encodeURIComponent(runId)}/integrator`, jsonRequest("POST", { taskIds: integrates, reason: integratorReason.trim(), ...(integratorTitle.trim().length > 0 ? { title: integratorTitle.trim() } : {}) }), { reload: true, success: "Tarea integradora creada." })}>
            <GitBranch aria-hidden className="h-4 w-4" /> Crear integrador
          </Button>
        </div>
      </section>
    </div>
  );
}

function OperationsTab({ runId, control, busy, onMutate }: { runId: string; control: PlanControlPlane; busy: string | null; onMutate: PlanMutation }): React.ReactElement {
  const [confirmFork, setConfirmFork] = useState(false);
  return (
    <div className="grid gap-4">
      <section>
        <h4 className="m-0 text-xs font-semibold text-[var(--color-text)]">Fork no destructivo</h4>
        <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">Crea un run nuevo desde el último checkpoint. El run actual permanece intacto.</p>
        {confirmFork ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" busy={busy === "fork"} onClick={() => void onMutate("fork", `/api/runs/${encodeURIComponent(runId)}/fork`, jsonRequest("POST", {}), { success: "Fork creado.", navigateToRun: true })}>
              <GitFork aria-hidden className="h-4 w-4" /> Crear y abrir fork
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setConfirmFork(false)}>Cancelar</Button>
          </div>
        ) : (
          <Button className="mt-2" variant="ghost" size="sm" disabled={!control.canFork} onClick={() => setConfirmFork(true)}>
            <GitFork aria-hidden className="h-4 w-4" /> Preparar fork
          </Button>
        )}
      </section>
      <section className="border-t border-[var(--color-border)] pt-3">
        <h4 className="m-0 text-xs font-semibold text-[var(--color-text)]">Diagnóstico operativo</h4>
        <p className="m-0 mt-1 text-xs text-[var(--color-text-muted)]">Inspecciona leases, checkpoints, event log y salud del registro persistido.</p>
        <a className="mt-2 inline-flex h-8 items-center rounded-[var(--r-md)] border border-[var(--color-border-control)] px-3 text-label font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]" href={`/api/runs/${encodeURIComponent(runId)}/diagnostics`} target="_blank" rel="noreferrer">
          Abrir diagnóstico JSON
        </a>
      </section>
    </div>
  );
}

type PlanMutation = (
  key: string,
  path: string,
  init: RequestInit,
  options: { reload?: boolean; success: string; navigateToRun?: boolean }
) => Promise<void>;

function riskRecommendationLabel(recommendation: PlanControlPlane["risks"][number]["recommendation"]): string {
  switch (recommendation) {
    case "run_parallel": return "Puede ejecutarse en paralelo";
    case "serialize": return "Conviene serializar estas tareas";
    case "add_dependency": return "Conviene agregar una dependencia";
    case "requires_human_review": return "Requiere revisión humana";
  }
}

function NodeSelect({ label, nodes, value, onChange }: { label: string; nodes: PlanControlNode[]; value: string; onChange: (value: string) => void }): React.ReactElement {
  return (
    <label className="grid gap-1 text-xs font-medium text-[var(--color-text-muted)]">
      {label}
      <select className="mh-select h-8 text-meta" value={value} onChange={(event) => onChange(event.target.value)}>
        {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
      </select>
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.ReactElement {
  return (
    <label className="grid gap-1 text-xs font-medium text-[var(--color-text-muted)]">
      {label}
      <input className="mh-input h-8 px-2 text-xs" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextArea({ label, value, rows, mono = false, onChange }: { label: string; value: string; rows: number; mono?: boolean; onChange: (value: string) => void }): React.ReactElement {
  return (
    <label className="mt-2 grid gap-1 text-xs font-medium text-[var(--color-text-muted)]">
      {label}
      <textarea className={`mh-input resize-y px-2 py-1.5 text-xs leading-relaxed ${mono ? "mh-mono" : ""}`} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="bg-[var(--color-surface)] px-3 py-2">
      <span className="block text-eyebrow uppercase text-[var(--color-text-subtle)]">{label}</span>
      <strong className="mh-mono mt-1 block text-sm font-semibold text-[var(--color-text)]">{value}</strong>
    </div>
  );
}

function Feedback({ tone, children }: { tone: "good" | "bad"; children: React.ReactNode }): React.ReactElement {
  return <p role={tone === "bad" ? "alert" : "status"} className={`m-0 rounded-[var(--r-sm)] border px-3 py-2 text-xs ${tone === "bad" ? "border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)]" : "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-fg)]"}`}>{children}</p>;
}

function SurfaceState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }): React.ReactElement {
  return (
    <div className="grid gap-2 p-4 text-center">
      <span className="mx-auto text-[var(--color-text-subtle)]">{icon}</span>
      <strong className="text-sm text-[var(--color-text)]">{title}</strong>
      <p className="m-0 text-xs leading-relaxed text-[var(--color-text-muted)]">{detail}</p>
    </div>
  );
}

function nodeDraft(node: PlanControlNode): NodeDraft {
  return {
    title: node.title,
    objective: node.objective,
    allowedPaths: node.allowedPaths.join("\n"),
    forbiddenPaths: node.forbiddenPaths.join("\n"),
    acceptanceCriteria: node.acceptanceCriteria.join("\n"),
    manual: node.manual,
    executorSelection: node.executorSelection === null ? "" : `${node.executorSelection.executorId}/${node.executorSelection.model}`
  };
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function selectionFromValue(value: string): { executorId: string; model: string } {
  const [executorId, ...model] = value.split("/");
  return { executorId: executorId ?? "", model: model.join("/") };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`);
  return payload;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
