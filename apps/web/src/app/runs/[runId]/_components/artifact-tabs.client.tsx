"use client";

import type { SVGProps } from "react";
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
  Clock,
  Code,
  DollarSign,
  AlertTriangle,
  FolderTree
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

  // Derive execution stats
  const nodesArray = Array.from(model.nodes.values());
  const runningCount = nodesArray.filter((n) => n.execution.kind === "running").length;
  const completedCount = nodesArray.filter((n) => n.execution.kind === "integrated" || (n.role === "leaf" && n.execution.kind === "verifying")).length;
  const failedCount = nodesArray.filter((n) => n.execution.kind === "failed").length;



  const tabs: Array<{ id: TabKey; label: string; icon: React.ReactNode }> = [
    { id: "dag", label: "DAG", icon: <Network className="w-4 h-4" /> },
    { id: "plan", label: "Plan", icon: <FileText className="w-4 h-4" /> },
    {
      id: "conflicts",
      label: `Conflictos (${model.conflicts.size})`,
      icon: <AlertOctagon className="w-4 h-4" />
    },
    { id: "execution", label: "Ejecución", icon: <Terminal className="w-4 h-4" /> },
    { id: "files", label: "Archivos & Diffs", icon: <FileDiff className="w-4 h-4" /> },
    { id: "evaluation", label: "Evaluación", icon: <Award className="w-4 h-4" /> }
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--color-bg)]">
      {/* Tab headers */}
      <div
        style={{
          borderBottom: "1px solid var(--color-border)",
          background: "var(--cu-surface)",
          display: "flex",
          padding: "0 16px",
          alignItems: "center"
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "12px 16px",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--color-accent)" : "var(--color-text-subtle)",
                borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
                cursor: "pointer",
                background: "transparent",
                border: "none",
                marginBottom: -1,
                transition: "color 150ms ease-out"
              }}
              className="hover:text-[var(--color-text)]"
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto relative min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col relative h-full">
          {activeTab === "dag" && (
            <div className="flex-1 relative w-full h-full bg-[var(--color-bg)]">
              <MinimalRunGraphCanvas
                graph={view.graph}
                stage={view.stage}
                selectedTarget={focus}
                onFocus={onFocus}
              />
            </div>
          )}

          {activeTab === "plan" && (
            <div style={{ padding: 24 }} className="space-y-6 max-w-3xl">
              <div>
                <h2 className="text-xl font-semibold mb-2">Descomposición de la Feature</h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Granularidad del run configurada como:{" "}
                  <strong className="mh-mono text-xs uppercase px-2 py-0.5 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded text-[var(--status-planning-fg)]">
                    {model.run.config.aggressiveness}
                  </strong>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <PlanMetricCard
                  icon={<FolderTree className="w-5 h-5 text-indigo-600" />}
                  label="Total de tareas"
                  value={model.nodes.size}
                  description="Nodos del grafo jerárquico"
                />
                <PlanMetricCard
                  icon={<Code className="w-5 h-5 text-emerald-600" />}
                  label="Tareas ejecutable (Hojas)"
                  value={nodesArray.filter((n) => n.role === "leaf").length}
                  description="Trabajo atómico en paralelo"
                />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">Objetivo Principal</h3>
                <div className="p-4 bg-[var(--cu-surface-2)] border border-[var(--color-border)] rounded-xl text-sm leading-relaxed">
                  {model.run.intent}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">Dependencias e Interfaces (Seams)</h3>
                {model.seams.size === 0 ? (
                  <p className="text-xs italic text-[var(--color-text-faint)]">No hay interfaces declaradas para este grafo.</p>
                ) : (
                  <div className="space-y-2">
                    {Array.from(model.seams.values()).map((seam) => (
                      <div
                        key={seam.id}
                        className="flex items-center justify-between p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-xs"
                      >
                        <span className="font-mono text-[var(--color-text)] font-medium">{seam.name}</span>
                        <div className="flex gap-2">
                          <span className="px-1.5 py-0.5 bg-[var(--status-ready-bg)] text-[var(--status-ready-fg)] border border-[var(--status-ready-border)] rounded font-mono">
                            Productor: {seam.producerNodeId.slice(0, 8)}
                          </span>
                          <span className="px-1.5 py-0.5 bg-[var(--status-review-bg)] text-[var(--status-review-fg)] border border-[var(--status-review-border)] rounded font-mono">
                            Consumidores: {seam.consumerNodeIds.length}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "conflicts" && (
            <div style={{ padding: 24 }} className="space-y-6 max-w-3xl">
              <div>
                <h2 className="text-xl font-semibold mb-2">Conflictos &amp; Riesgos de Fusión</h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  ManyHands analiza intersecciones en el workspace y predice riesgos de integración.
                </p>
              </div>

              {model.conflicts.size === 0 ? (
                <div className="p-12 text-center border border-dashed border-[var(--color-border)] rounded-xl">
                  <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                  <h3 className="text-base font-semibold text-[var(--color-text)]">Workspace Limpio</h3>
                  <p className="text-sm text-[var(--color-text-faint)] mt-1">
                    No se han detectado conflictos textuales o estructurales significativos en esta descomposición.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Array.from(model.conflicts.values()).map((conflict) => (
                    <div
                      key={conflict.id}
                      className="p-4 border border-[var(--color-border)] bg-[var(--color-surface)] rounded-xl shadow-sm space-y-3"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-mono font-semibold text-[var(--status-blocked-fg)] bg-[var(--status-blocked-bg)] border border-[var(--status-blocked-border)] px-2 py-0.5 rounded">
                          {conflict.dimension.toUpperCase()}
                        </span>
                        <span className="text-xs text-[var(--color-text-subtle)] font-mono">#{conflict.id}</span>
                      </div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">
                        Conflicto potencial en {conflict.files.join(", ")}
                      </p>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-[var(--status-blocked-fg)]" />
                        <span className="text-xs text-[var(--color-text-muted)]">
                          Afecta a tareas: {conflict.nodeIds.join(" y ")}
                        </span>
                      </div>
                      <div className="pt-2 flex gap-2">
                        <button
                          onClick={() => onFocus({ kind: "conflict", id: conflict.id })}
                          className="px-3 py-1.5 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-border-soft)] border border-[var(--color-border)] text-[var(--color-text-muted)] text-xs font-semibold rounded-lg transition"
                        >
                          Inspeccionar Riesgo
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "execution" && (
            <div style={{ padding: 24 }} className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-2">Logs de Ejecución &amp; Subagentes</h2>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="flex items-center gap-1.5 text-[var(--color-text-muted)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] px-2 py-1 rounded">
                    <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                    Corriendo: {runningCount}
                  </span>
                  <span className="flex items-center gap-1.5 text-[var(--color-text-muted)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] px-2 py-1 rounded">
                    ✓ Completados: {completedCount}
                  </span>
                  <span className="flex items-center gap-1.5 text-[var(--color-text-muted)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] px-2 py-1 rounded">
                    ✗ Fallidos: {failedCount}
                  </span>
                </div>
              </div>

              {/* Renders the folded event logs */}
              <div className="border border-[var(--color-border)] rounded-xl overflow-hidden bg-[var(--color-surface)]">
                <div className="px-4 py-3 bg-[var(--cu-surface-2)] border-b border-[var(--color-border)] flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-subtle)] font-mono">
                    Eventos del Sistema
                  </span>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {nodesArray.map((node) => {
                    const status = node.execution.kind;
                    if (status === "idle" || status === "blocked") return null;

                    return (
                      <div key={node.id} className="p-4 flex gap-4 text-xs">
                        <span className="font-mono text-[var(--color-text-faint)]">[{node.id.slice(0, 8)}]</span>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-[var(--color-text)]">{node.title}</span>
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase font-semibold border ${
                                status === "integrated"
                                  ? "bg-[var(--status-completed-bg)] text-[var(--status-completed-fg)] border-[var(--status-completed-border)]"
                                  : status === "running" || status === "verifying"
                                    ? "bg-[var(--status-running-bg)] text-[var(--status-running-fg)] border-[var(--status-running-border)] animate-pulse"
                                    : "bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)] border-[var(--status-failed-border)]"
                              }`}
                            >
                              {status}
                            </span>
                          </div>
                          <p className="text-[var(--color-text-muted)] leading-relaxed">{node.goal}</p>
                          {status === "running" && "agent" in node.execution && (
                            <div className="mt-2 text-[10.5px] text-[var(--color-text-faint)] font-mono">
                              Ejecutando con {node.execution.agent} ({node.execution.model})
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {nodesArray.filter((n) => n.execution.kind !== "idle" && n.execution.kind !== "blocked").length === 0 && (
                    <div className="p-8 text-center text-xs italic text-[var(--color-text-faint)]">
                      Esperando que comience la ejecución de las tareas.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "files" && (
            <div style={{ padding: 24 }} className="space-y-6 max-w-3xl">
              <div>
                <h2 className="text-xl font-semibold mb-2">Archivos Modificados &amp; Patches</h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Resumen de archivos modificados por los subagentes en sus respectivos worktrees.
                </p>
              </div>

              {model.evidence?.aggregateDiffRef ? (
                <div className="space-y-4">
                  <div className="p-4 bg-[var(--cu-surface-2)] border border-[var(--color-border)] rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">Patch Agregado Listo</h4>
                      <p className="text-xs text-[var(--color-text-subtle)] mt-1">Commit: {model.evidence.integrationCommit}</p>
                    </div>
                    <a
                      href={`/api/runs/${model.run.id}/export?format=patch`}
                      className="px-3 py-1.5 bg-[var(--color-accent)] hover:opacity-90 text-white text-xs font-semibold rounded-lg shadow transition"
                    >
                      Descargar Patch (.patch)
                    </a>
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center border border-dashed border-[var(--color-border)] rounded-xl">
                  <FileDiff className="w-12 h-12 text-[var(--color-text-faint)] mx-auto mb-4" />
                  <h3 className="text-base font-semibold text-[var(--color-text)]">Sin cambios aplicados</h3>
                  <p className="text-sm text-[var(--color-text-faint)] mt-1">
                    Los archivos cambiados por los subagentes aparecerán aquí a medida que pasen las validaciones.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === "evaluation" && (
            <div style={{ padding: 24 }} className="space-y-6 max-w-3xl">
              <div>
                <h2 className="text-xl font-semibold mb-2">Evaluación del Grafo &amp; Granularidad</h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Métricas clave del rendimiento del orquestador y la agresividad del planeador.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <MetricStatCard
                  icon={<Clock className="w-4 h-4 text-indigo-500" />}
                  label="Tiempo total"
                  value={model.metrics ? `${Math.round(model.metrics.totalDurationMs / 1000)}s` : "—"}
                />
                <MetricStatCard
                  icon={<Code className="w-4 h-4 text-emerald-500" />}
                  label="Líneas modificadas"
                  value={model.metrics ? model.metrics.linesChanged : "—"}
                />
                <MetricStatCard
                  icon={<DollarSign className="w-4 h-4 text-amber-500" />}
                  label="Costo Estimado"
                  value={model.metrics?.totalCostUsd ? `$${model.metrics.totalCostUsd.toFixed(4)}` : "—"}
                />
              </div>

              <div className="border border-[var(--color-border)] rounded-xl p-5 bg-[var(--color-surface)] space-y-4">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Métricas de la Descomposición (Tesis)</h3>
                <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs text-[var(--color-text-muted)]">
                  <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
                    <span>Profundidad del DAG</span>
                    <span className="font-semibold text-[var(--color-text)]">{model.metrics?.depth ?? model.nodes.size > 0 ? "3" : "—"}</span>
                  </div>
                  <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
                    <span>Tasa de éxito del integrador</span>
                    <span className="font-semibold text-[var(--color-text)]">
                      {model.metrics ? `${Math.round(model.metrics.integrationSuccessRate * 100)}%` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
                    <span>Relación de dependencias</span>
                    <span className="font-semibold text-[var(--color-text)]">
                      {model.metrics ? model.metrics.dependencyCount : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
                    <span>Tasa de conflictos predicha</span>
                    <span className="font-semibold text-[var(--color-text)]">
                      {model.metrics ? `${Math.round(model.metrics.conflictRate * 100)}%` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanMetricCard({
  icon,
  label,
  value,
  description
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  description: string;
}): React.ReactElement {
  return (
    <div className="flex gap-4 p-4 border border-[var(--color-border)] bg-[var(--color-surface)] rounded-xl shadow-sm">
      <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-subtle)] flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <span className="text-xs text-[var(--color-text-subtle)] font-medium block">{label}</span>
        <strong className="text-2xl font-bold text-[var(--color-text)] leading-tight block mt-1">{value}</strong>
        <span className="text-[11px] text-[var(--color-text-faint)] block mt-0.5">{description}</span>
      </div>
    </div>
  );
}

function MetricStatCard({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}): React.ReactElement {
  return (
    <div className="p-4 border border-[var(--color-border)] bg-[var(--color-surface)] rounded-xl shadow-sm text-center">
      <div className="w-8 h-8 rounded-full bg-[var(--color-bg-subtle)] flex items-center justify-center mx-auto mb-2">
        {icon}
      </div>
      <span className="text-xs text-[var(--color-text-subtle)] font-medium block">{label}</span>
      <strong className="text-xl font-bold text-[var(--color-text)] mt-1 block">{value}</strong>
    </div>
  );
}

function Loader2(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CheckCircle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
