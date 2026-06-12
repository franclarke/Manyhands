"use client";

import type { RunModel } from "@/lib/run-model/types";
import type { FocusTarget } from "@/lib/run-model/focus-view";
import type { MinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import { MinimalRunGraphCanvas } from "@/components/run-model/minimal-run-graph";
import {
  Network,
  FileText,
  AlertOctagon,
  Terminal,
  FileDiff,
  Award,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download
} from "lucide-react";

interface ArtifactTabsProps {
  model: RunModel;
  view: MinimalWorkspaceView;
  focus: FocusTarget | null;
  onFocus: (target: FocusTarget | null) => void;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

type TabKey = "dag" | "plan" | "conflicts" | "execution" | "files" | "evaluation";

export function ArtifactTabs({
  model,
  view,
  focus,
  onFocus,
  activeTab,
  onTabChange
}: ArtifactTabsProps): React.ReactElement {
  const nodesArray = Array.from(model.nodes.values());
  const runningCount = nodesArray.filter((n) => n.execution.kind === "running").length;
  const completedCount = nodesArray.filter((n) => n.execution.kind === "integrated" || (n.role === "leaf" && n.execution.kind === "verifying")).length;
  const failedCount = nodesArray.filter((n) => n.execution.kind === "failed").length;

  const tabs: Array<{ id: TabKey; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: "dag", label: "Trabajo", icon: <Network aria-hidden className="h-4 w-4" /> },
    { id: "plan", label: "Plan", icon: <FileText aria-hidden className="h-4 w-4" /> },
    {
      id: "conflicts",
      label: "Riesgos",
      icon: <AlertOctagon aria-hidden className="h-4 w-4" />,
      ...(model.conflicts.size > 0 ? { badge: model.conflicts.size } : {})
    },
    { id: "execution", label: "Eventos", icon: <Terminal aria-hidden className="h-4 w-4" /> },
    { id: "files", label: "Diffs", icon: <FileDiff aria-hidden className="h-4 w-4" /> },
    { id: "evaluation", label: "Evidencia", icon: <Award aria-hidden className="h-4 w-4" /> }
  ];

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Vistas del run"
        className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              id={`mh-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`mh-tabpanel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const index = tabs.findIndex((t) => t.id === activeTab);
                const next = event.key === "ArrowRight"
                  ? tabs[(index + 1) % tabs.length]!
                  : tabs[(index - 1 + tabs.length) % tabs.length]!;
                onTabChange(next.id);
                document.getElementById(`mh-tab-${next.id}`)?.focus();
              }}
              className={[
                "-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 bg-transparent px-3 py-3 text-[12.5px] transition-colors duration-150",
                isActive
                  ? "border-[var(--color-accent)] font-semibold text-[var(--color-text)]"
                  : "border-transparent font-medium text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
              ].join(" ")}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined ? (
                <span className="mh-mono rounded border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] px-1 text-[10px] font-semibold text-[var(--status-blocked-fg)]">
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="relative flex min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex h-full min-w-0 flex-1 flex-col">
          <TabPanel id="dag" active={activeTab === "dag"} className="relative h-full w-full flex-1 bg-[var(--color-bg)] p-0">
            {activeTab === "dag" ? (
              <MinimalRunGraphCanvas
                graph={view.graph}
                stage={view.stage}
                selectedTarget={focus}
                onFocus={onFocus}
                fill
              />
            ) : null}
          </TabPanel>

          <TabPanel id="plan" active={activeTab === "plan"}>
            <header>
              <h2 className="m-0 text-lg font-semibold text-[var(--color-text)]">Descomposición de la feature</h2>
              <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
                {model.nodes.size > 0 ? (
                  <>
                    <strong className="mh-mono font-semibold text-[var(--color-text)]">{model.nodes.size}</strong> tareas ·{" "}
                    <strong className="mh-mono font-semibold text-[var(--color-text)]">
                      {nodesArray.filter((n) => n.role === "leaf").length}
                    </strong>{" "}
                    hojas ejecutables en paralelo · granularidad{" "}
                    <strong className="mh-mono font-semibold uppercase text-[var(--color-text)]">{model.run.config.aggressiveness}</strong>
                  </>
                ) : (
                  <>Granularidad configurada: <strong className="mh-mono uppercase">{model.run.config.aggressiveness}</strong></>
                )}
              </p>
            </header>

            {model.nodes.size === 0 ? (
              <EmptyLensPanel
                title="El plan todavía se está formando"
                detail="Cuando llegue el primer nodo, esta vista mostrará la descomposición, las hojas ejecutables y las costuras entre agentes."
              />
            ) : (
              <>
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Objetivo principal</h3>
                  <div className="rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm leading-relaxed text-[var(--color-text)]">
                    {model.run.intent}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
                    Interfaces entre agentes (costuras)
                    {model.seams.size > 0 ? (
                      <span className="mh-mono ml-2 text-xs font-normal text-[var(--color-text-subtle)]">{model.seams.size}</span>
                    ) : null}
                  </h3>
                  {model.seams.size === 0 ? (
                    <p className="text-xs text-[var(--color-text-subtle)]">No hay interfaces declaradas para este grafo.</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                      {Array.from(model.seams.values()).map((seam) => (
                        <li
                          key={seam.id}
                          className="flex items-center justify-between gap-3 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => onFocus({ kind: "seam", id: seam.id })}
                            className="mh-mono cursor-pointer truncate border-0 bg-transparent p-0 text-left font-medium text-[var(--color-text)] hover:text-[var(--color-accent-hover)]"
                            title={`Inspeccionar costura ${seam.name}`}
                          >
                            {seam.name}
                          </button>
                          <span className="mh-mono flex shrink-0 gap-3 text-[11px] text-[var(--color-text-subtle)]">
                            <span title={`Productor: ${seam.producerNodeId}`}>
                              productor {seam.producerNodeId.slice(0, 8)}
                            </span>
                            <span>·</span>
                            <span>{seam.consumerNodeIds.length} consumidores</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </TabPanel>

          <TabPanel id="conflicts" active={activeTab === "conflicts"}>
            <header>
              <h2 className="m-0 text-lg font-semibold text-[var(--color-text)]">Conflictos y riesgos de fusión</h2>
              <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
                ManyHands analiza intersecciones en el workspace y predice riesgos de integración.
              </p>
            </header>

            {model.conflicts.size === 0 ? (
              <div className="rounded-[var(--r-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8">
                <CheckCircle2 aria-hidden className="mb-3 h-8 w-8 text-[var(--status-completed-fg)]" />
                <h3 className="m-0 text-base font-semibold text-[var(--color-text)]">Sin conflictos detectados</h3>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--color-text-muted)]">
                  No se detectaron intersecciones textuales o estructurales significativas en esta descomposición.
                </p>
              </div>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {Array.from(model.conflicts.values()).map((conflict) => (
                  <li
                    key={conflict.id}
                    className="space-y-2.5 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="mh-mono rounded border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] px-2 py-0.5 text-xs font-semibold uppercase text-[var(--status-blocked-fg)]">
                        {conflict.dimension}
                      </span>
                      <span className="mh-mono text-xs text-[var(--color-text-subtle)]">{conflict.id}</span>
                    </div>
                    <p className="m-0 text-sm font-semibold text-[var(--color-text)]">
                      Conflicto potencial en {conflict.files.join(", ")}
                    </p>
                    <p className="m-0 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-[var(--status-blocked-fg)]" />
                      Afecta a: {conflict.nodeIds.map((id) => model.nodes.get(id)?.title ?? id.slice(0, 8)).join(" · ")}
                    </p>
                    <button
                      type="button"
                      onClick={() => onFocus({ kind: "conflict", id: conflict.id })}
                      className="cursor-pointer rounded-[var(--r-md)] border border-[var(--color-border-control)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
                    >
                      Inspeccionar riesgo
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>

          <TabPanel id="execution" active={activeTab === "execution"}>
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold text-[var(--color-text)]">Eventos de ejecución</h2>
                <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
                  Actividad de los subagentes por tarea, en orden del orquestador.
                </p>
              </div>
              <div className="mh-mono flex gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1 text-[var(--color-text-muted)]">
                  {runningCount > 0 ? (
                    <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-[var(--status-running-fg)]" />
                  ) : null}
                  {runningCount} ejecutando
                </span>
                <span className="rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1 text-[var(--color-text-muted)]">
                  {completedCount} completados
                </span>
                <span
                  className={[
                    "rounded border px-2 py-1",
                    failedCount > 0
                      ? "border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)]"
                      : "border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]"
                  ].join(" ")}
                >
                  {failedCount} fallidos
                </span>
              </div>
            </header>

            <div className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="divide-y divide-[var(--color-border-soft)]">
                {nodesArray.map((node) => {
                  const status = node.execution.kind;
                  if (status === "idle" || status === "blocked") return null;

                  return (
                    <div key={node.id} className="flex gap-4 p-4 text-xs">
                      <span className="mh-mono shrink-0 text-[var(--color-text-faint)]">{node.id.slice(0, 8)}</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold text-[var(--color-text)]">{node.title}</span>
                          <span
                            className={[
                              "mh-mono shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase",
                              status === "integrated"
                                ? "border-[var(--status-integrated-border)] bg-[var(--status-integrated-bg)] text-[var(--status-integrated-fg)]"
                                : status === "running" || status === "verifying"
                                  ? "border-[var(--status-running-border)] bg-[var(--status-running-bg)] text-[var(--status-running-fg)]"
                                  : status === "failed"
                                    ? "border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)]"
                                    : "border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]"
                            ].join(" ")}
                          >
                            {status}
                          </span>
                        </div>
                        <p className="m-0 leading-relaxed text-[var(--color-text-muted)]">{node.goal}</p>
                        {status === "running" && "agent" in node.execution ? (
                          <p className="mh-mono m-0 mt-1.5 text-[10.5px] text-[var(--color-text-subtle)]">
                            {node.execution.agent} · {node.execution.model}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {nodesArray.filter((n) => n.execution.kind !== "idle" && n.execution.kind !== "blocked").length === 0 ? (
                  <div className="p-8 text-center text-xs text-[var(--color-text-subtle)]">
                    Esperando que comience la ejecución de las tareas.
                  </div>
                ) : null}
              </div>
            </div>
          </TabPanel>

          <TabPanel id="files" active={activeTab === "files"}>
            <header>
              <h2 className="m-0 text-lg font-semibold text-[var(--color-text)]">Archivos modificados y patches</h2>
              <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
                Resumen de archivos modificados por los subagentes en sus worktrees.
              </p>
            </header>

            {model.evidence?.aggregateDiffRef ? (
              <div className="flex items-center justify-between gap-4 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="min-w-0">
                  <h4 className="m-0 text-sm font-semibold text-[var(--color-text)]">Patch agregado listo</h4>
                  <p className="mh-mono mt-1 truncate text-xs text-[var(--color-text-subtle)]">
                    commit {model.evidence.integrationCommit}
                  </p>
                </div>
                <a
                  href={`/api/runs/${model.run.id}/export?format=patch`}
                  className="flex shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent-contrast)] transition-colors hover:border-[var(--color-accent-hover)] hover:bg-[var(--color-accent-hover)]"
                >
                  <Download aria-hidden className="h-3.5 w-3.5" />
                  Descargar patch
                </a>
              </div>
            ) : (
              <EmptyLensPanel
                title="Sin cambios aplicados"
                detail="Los archivos cambiados por los subagentes aparecerán acá a medida que pasen las validaciones."
              />
            )}
          </TabPanel>

          <TabPanel id="evaluation" active={activeTab === "evaluation"}>
            <header>
              <h2 className="m-0 text-lg font-semibold text-[var(--color-text)]">Evidencia y métricas del run</h2>
              <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
                Resultado verificable del orquestador y métricas de la descomposición.
              </p>
            </header>

            {model.metrics === undefined && model.evidence === undefined ? (
              <EmptyLensPanel
                title="La evidencia aparece al finalizar"
                detail="Cuando el run llegue a disposición, ManyHands mostrará tests, diff agregado, duración, costo y métricas operativas."
              />
            ) : (
              <div className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
                <dl className="m-0 grid grid-cols-1 divide-y divide-[var(--color-border-soft)] text-xs sm:grid-cols-2 sm:divide-y-0">
                  <MetricRow label="Tiempo total" value={model.metrics ? `${Math.round(model.metrics.totalDurationMs / 1000)}s` : "—"} />
                  <MetricRow label="Líneas modificadas" value={model.metrics?.linesChanged ?? "—"} />
                  <MetricRow
                    label="Costo estimado"
                    value={model.metrics?.totalCostUsd !== undefined ? `$${model.metrics.totalCostUsd.toFixed(4)}` : "—"}
                  />
                  <MetricRow label="Profundidad del DAG" value={model.metrics?.depth ?? "—"} />
                  <MetricRow
                    label="Éxito del integrador"
                    value={model.metrics ? `${Math.round(model.metrics.integrationSuccessRate * 100)}%` : "—"}
                  />
                  <MetricRow label="Dependencias" value={model.metrics?.dependencyCount ?? "—"} />
                  <MetricRow
                    label="Tasa de conflictos"
                    value={model.metrics ? `${Math.round(model.metrics.conflictRate * 100)}%` : "—"}
                  />
                </dl>
              </div>
            )}
          </TabPanel>
        </div>
      </div>
    </div>
  );
}

function TabPanel({
  id,
  active,
  className,
  children
}: {
  id: string;
  active: boolean;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`mh-tabpanel-${id}`}
      aria-labelledby={`mh-tab-${id}`}
      className={className ?? "max-w-3xl space-y-6 p-6"}
    >
      {children}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string | number }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border-soft)] px-4 py-2.5 last:border-b-0 sm:border-b">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mh-mono m-0 font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function EmptyLensPanel({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return (
    <div className="rounded-[var(--r-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8">
      <span className="mh-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">
        Sin datos todavía
      </span>
      <h3 className="mt-3 text-base font-semibold text-[var(--color-text)]">{title}</h3>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--color-text-muted)]">{detail}</p>
    </div>
  );
}
