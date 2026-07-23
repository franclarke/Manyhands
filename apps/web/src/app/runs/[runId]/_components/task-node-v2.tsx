"use client";

import { AlertTriangle, Check, GitCommitHorizontal, PackageCheck } from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import type { RunNodeView } from "@/lib/run-model/types";
import type { LifecycleMedal } from "./cockpit-state";

export interface TaskNodeV2Data extends Record<string, unknown> {
  node: RunNodeView;
  medal: LifecycleMedal;
  selected: boolean;
  dimmed: boolean;
  blocked: boolean;
  decisionIds: readonly string[];
  onOpenDecision: (decisionId: string) => void;
}

export type TaskNodeV2FlowNode = Node<TaskNodeV2Data, "taskNodeV2">;

export function TaskNodeV2({ data }: NodeProps<TaskNodeV2FlowNode>): React.ReactElement {
  const { node, medal, selected, dimmed, blocked, decisionIds, onOpenDecision } = data;
  const visual = medalVisual(medal.state);
  return (
    <article
      aria-label={`${node.title}. ${medal.badge || fallbackStatus(node.status)}`}
      className={[
        "relative w-[246px] rounded-xl border-2 bg-[var(--color-surface-raised)] px-4 py-3 shadow-sm",
        "transition-[border-color,box-shadow,opacity,transform] duration-200 motion-reduce:transition-none",
        visual.border,
        visual.animation,
        selected ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg)]" : "",
        dimmed ? "opacity-30" : "opacity-100",
        blocked ? "shadow-[0_0_0_3px_color-mix(in_srgb,var(--status-review-fg)_18%,transparent)]" : ""
      ].join(" ")}
    >
      <Handle id="target" type="target" position={Position.Top} className="opacity-0" />
      <Handle id="source" type="source" position={Position.Bottom} className="opacity-0" />
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-micro uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">{node.kind}</span>
        {medal.state !== "none" ? (
          <span className={`inline-flex max-w-[155px] items-center gap-1 rounded-full px-2 py-1 text-micro font-semibold leading-none ${visual.badge}`}>
            <MedalIcon state={medal.state} />
            <span className="truncate">{medal.badge}</span>
          </span>
        ) : (
          <span className="text-micro font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">{fallbackStatus(node.status)}</span>
        )}
      </div>
      <h3 className="mt-2 text-sm font-semibold leading-5 text-[var(--color-text)]">{node.title}</h3>
      <p className="mt-1 line-clamp-2 text-micro leading-4 text-[var(--color-text-muted)]">{node.goal}</p>
      {medal.state === "failed" ? (
        <p role="status" className="mt-2 flex gap-1.5 rounded-lg bg-red-50 p-2 text-micro leading-4 text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />{medal.detail}
        </p>
      ) : null}
      {blocked ? (
        <div className="mt-3 border-t border-[var(--color-border)] pt-2">
          <span className="block text-micro font-medium text-[var(--status-review-fg)]">Pausado por una decisión de este subgrafo</span>
          {decisionIds.map((decisionId) => (
            <button
              key={decisionId}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenDecision(decisionId);
              }}
              className="nodrag mt-1 w-full rounded-md border border-[var(--status-review-border)] bg-[var(--status-review-bg)] px-2 py-1.5 text-left text-micro font-semibold text-[var(--status-review-fg)] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Revisar decisión
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function MedalIcon({ state }: { state: LifecycleMedal["state"] }): React.ReactElement | null {
  if (state === "candidate") return <GitCommitHorizontal aria-hidden className="h-3 w-3" />;
  if (state === "verified") return <Check aria-hidden className="h-3 w-3" />;
  if (state === "delivered") return <PackageCheck aria-hidden className="h-3 w-3" />;
  if (state === "failed") return <AlertTriangle aria-hidden className="h-3 w-3" />;
  return null;
}

function medalVisual(state: LifecycleMedal["state"]): { border: string; badge: string; animation: string } {
  switch (state) {
    case "candidate": return {
      border: "border-amber-400",
      badge: "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-200",
      animation: "motion-safe:animate-pulse motion-reduce:animate-none"
    };
    case "verified": return {
      border: "border-emerald-500",
      badge: "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200",
      animation: ""
    };
    case "failed": return {
      border: "border-red-500",
      badge: "bg-red-100 text-red-950 dark:bg-red-950/60 dark:text-red-200",
      animation: ""
    };
    case "stale": return {
      border: "border-dashed border-slate-400",
      badge: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
      animation: ""
    };
    case "delivered": return {
      border: "border-violet-500",
      badge: "bg-violet-100 text-violet-950 dark:bg-violet-950/60 dark:text-violet-200",
      animation: ""
    };
    default: return { border: "border-[var(--color-border-strong)]", badge: "", animation: "" };
  }
}

function fallbackStatus(status: RunNodeView["status"]): string {
  const labels: Record<RunNodeView["status"], string> = {
    pending: "Pending",
    ready: "Ready",
    running: "Running",
    waiting: "Waiting",
    succeeded: "Complete",
    failed: "Failed",
    stale: "Stale"
  };
  return labels[status];
}
