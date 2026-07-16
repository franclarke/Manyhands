"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  GitMerge,
  Layers3,
  Network,
  PlayCircle,
  Route,
  Workflow
} from "lucide-react";
import type { FocusTarget } from "@/lib/run-model/focus-view";
import type { MinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import type { RunCanvasMode, RunCanvasProjection } from "@/lib/run-model/run-canvas-projection";
import { selectRunOutline, type RunOutlineFilter } from "@/lib/run-model/run-outline-view";
import type { VitalStatus } from "@/lib/run-model/workspace-view";

const FILTERS: Array<{ value: RunOutlineFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "running", label: "En ejecución" },
  { value: "blocked", label: "Bloqueadas" },
  { value: "failed", label: "Fallidas" },
  { value: "attention", label: "Requieren atención" },
  { value: "integrated", label: "Integradas" }
];

const MODES: Array<{ id: RunCanvasMode; label: string; icon: typeof Workflow }> = [
  { id: "tasks", label: "Tareas", icon: Workflow },
  { id: "scheduling", label: "Planificación", icon: Route },
  { id: "integration", label: "Integración", icon: GitMerge },
  { id: "interfaces", label: "Interfaces", icon: Braces }
];

export function RunOutline({
  view,
  selectedTarget,
  projection,
  onFocus,
  onOpenDecision
}: {
  view: MinimalWorkspaceView;
  selectedTarget: FocusTarget | null;
  projection: RunCanvasProjection;
  onFocus: (target: FocusTarget) => void;
  onOpenDecision: () => void;
}): React.ReactElement {
  const [filter, setFilter] = useState<RunOutlineFilter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const outline = useMemo(() => selectRunOutline(view, filter), [filter, view]);
  const byId = useMemo(() => new Map(outline.items.map((item) => [item.id, item])), [outline.items]);
  const visibleItems = outline.items.filter((item) => {
    let current = item.parentId !== null ? byId.get(item.parentId) : undefined;
    while (current !== undefined) {
      if (collapsed.has(current.id)) return false;
      current = current.parentId !== null ? byId.get(current.parentId) : undefined;
    }
    return true;
  });
  const compositeIds = new Set(view.details.nodes.filter((node) => node.role !== "leaf").map((node) => node.id));
  const failedCount = view.details.nodes.filter((node) => node.vital.status === "failed").length;
  const conflictCount = view.details.conflicts.filter((conflict) => conflict.status !== "resolved").length;

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]" aria-label="Run outline">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border-soft)] px-3">
        <span className="flex items-center gap-2 text-label font-semibold text-[var(--color-text)]">
          <Layers3 aria-hidden className="h-3.5 w-3.5 text-[var(--color-accent)]" />
          Estructura
        </span>
        <select
          aria-label="Filtrar tareas del outline"
          value={filter}
          onChange={(event) => setFilter(event.target.value as RunOutlineFilter)}
          className="h-7 max-w-[132px] rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-meta text-[var(--color-text-muted)] outline-none focus-visible:border-[var(--color-accent)]"
        >
          {FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {visibleItems.map((item) => {
          const expandable = compositeIds.has(item.id);
          const isCollapsed = collapsed.has(item.id);
          const selected = selectedTarget?.kind === "node" && selectedTarget.id === item.id;
          return (
            <div key={item.id} className="flex min-w-0 items-center" style={{ paddingLeft: `${Math.min(item.depth, 6) * 12}px` }}>
              {expandable ? (
                <button
                  type="button"
                  aria-label={`${isCollapsed ? "Expandir" : "Contraer"} ${item.title}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                    return next;
                  })}
                  className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
                >
                  {isCollapsed ? <ChevronRight aria-hidden className="h-3.5 w-3.5" /> : <ChevronDown aria-hidden className="h-3.5 w-3.5" />}
                </button>
              ) : <span aria-hidden className="w-6 shrink-0" />}
              <button
                type="button"
                onClick={() => onFocus({ kind: "node", id: item.id })}
                title={`${item.title} · ${item.label}`}
                className={[
                  "group flex min-w-0 flex-1 items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5 text-left transition-colors",
                  selected ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]",
                  item.hasMatchingDescendant ? "opacity-65" : ""
                ].join(" ")}
              >
                <StatusGlyph status={item.status} />
                <span className="min-w-0 flex-1 truncate text-label font-medium">{item.title}</span>
                {item.role !== "leaf" ? <span className="mh-mono text-micro uppercase text-[var(--color-text-subtle)]">{item.role === "root" ? "root" : "group"}</span> : null}
              </button>
            </div>
          );
        })}
        {visibleItems.length === 0 ? (
          <p className="m-0 px-3 py-6 text-center text-meta text-[var(--color-text-subtle)]">No hay tareas para este filtro.</p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-[var(--color-border-soft)] p-3">
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between text-meta font-semibold text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1.5"><Route aria-hidden className="h-3.5 w-3.5" />Planificación</span>
            <span className="mh-mono text-micro text-[var(--color-text-subtle)]" title="Política interna risk_aware">Por riesgo</span>
          </div>
          {projection.wave !== null ? (
            <div className="w-full rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-2 text-left">
              <span className="flex items-center justify-between text-label text-[var(--color-text)]">
                <strong>{projection.wave.label}</strong>
                <span className="mh-mono text-micro text-[var(--color-text-subtle)]">{projection.overlayNodeIds.length} seleccionadas</span>
              </span>
              <span className="mt-1 block text-meta text-[var(--color-text-subtle)]">{projection.wave.running} ejecutando · {projection.wave.serialized.length} serializadas</span>
            </div>
          ) : <p className="m-0 text-meta text-[var(--color-text-subtle)]">Sin wave seleccionada todavía.</p>}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-meta font-semibold text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1.5"><AlertTriangle aria-hidden className="h-3.5 w-3.5" />Atención</span>
            <span className="mh-mono text-micro text-[var(--color-text-subtle)]">{view.pendingAttentionCount + conflictCount + failedCount}</span>
          </div>
          {view.primaryAttention !== null ? (
            <button type="button" onClick={onOpenDecision} className="w-full rounded-[var(--r-md)] border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] px-2 py-2 text-left text-label text-[var(--status-blocked-fg)] hover:border-[var(--color-accent)]">
              Revisar y decidir →
              <span className="mt-0.5 block text-meta font-normal text-[var(--color-text-muted)]">{pluralize(view.primaryAttention.affectedNodeIds.length || 1, "parte del run afectada", "partes del run afectadas")}</span>
            </button>
          ) : <p className="m-0 flex items-center gap-1.5 text-meta text-[var(--color-text-subtle)]"><CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-[var(--status-integrated-fg)]" />Nada requiere atención.</p>}
        </div>
      </div>
    </aside>
  );
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function RunCanvasToolbar({
  mode,
  projection,
  onModeChange
}: {
  mode: RunCanvasMode;
  projection: RunCanvasProjection;
  onModeChange: (mode: RunCanvasMode) => void;
}): React.ReactElement {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3">
      <div role="tablist" aria-label="Proyección del Task DAG" className="flex items-center gap-0.5">
        {MODES.map((item) => {
          const Icon = item.icon;
          const active = item.id === mode;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onModeChange(item.id)}
              className={[
                "flex h-7 items-center gap-1.5 rounded-[var(--r-md)] px-2 text-meta font-medium transition-colors",
                active ? "bg-[var(--color-bg-subtle)] text-[var(--color-text)]" : "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
              ].join(" ")}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />{item.label}
            </button>
          );
        })}
      </div>
      {mode === "scheduling" && projection.wave !== null ? (
        <div className="ml-auto flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1 text-meta text-[var(--color-text-muted)]">
          <span className="mh-mono font-semibold text-[var(--color-accent)]">{projection.wave.label}</span>
          <span>{projection.overlayNodeIds.length} selected</span>
          <span aria-hidden className="text-[var(--color-border-strong)]">·</span>
          <span>{projection.wave.running} running</span>
          <span aria-hidden className="text-[var(--color-border-strong)]">·</span>
          <span>{projection.wave.serialized.length} serialized</span>
        </div>
      ) : (
        <span className="ml-auto hidden items-center gap-1.5 text-meta text-[var(--color-text-subtle)] sm:flex">
          <Network aria-hidden className="h-3.5 w-3.5" />Task DAG · {projection.graph.nodes.length} tasks
        </span>
      )}
    </div>
  );
}

function StatusGlyph({ status }: { status: VitalStatus }): React.ReactElement {
  if (status === "done") return <CheckCircle2 aria-label="Integrated" className="h-3.5 w-3.5 shrink-0 text-[var(--status-integrated-fg)]" />;
  if (status === "running" || status === "verifying" || status === "repairing") return <PlayCircle aria-label={status} className="h-3.5 w-3.5 shrink-0 text-[var(--status-running-fg)]" />;
  if (status === "failed") return <AlertTriangle aria-label="Failed" className="h-3.5 w-3.5 shrink-0 text-[var(--status-failed-fg)]" />;
  if (status === "blocked" || status === "gated" || status === "obsolete") return <Circle aria-label={status} className="h-3.5 w-3.5 shrink-0 stroke-[var(--status-blocked-fg)]" />;
  return <Circle aria-label={status} className="h-3.5 w-3.5 shrink-0 stroke-[var(--color-text-subtle)]" />;
}
