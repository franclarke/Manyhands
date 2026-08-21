"use client";

import { AlertTriangle, Check, GitCommitHorizontal, LoaderCircle, PackageCheck } from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import type { RunNodeView } from "@/lib/run-model/types";
import { nodeRuntimePresentation, type NodeRecoveryPresentation } from "@/lib/run-model/node-live-presentation";
import type { LifecycleMedal } from "./cockpit-state";

export interface TaskNodeV2Data extends Record<string, unknown> {
  node: RunNodeView;
  medal: LifecycleMedal;
  recovery: NodeRecoveryPresentation | null;
  selected: boolean;
  dimmed: boolean;
  blocked: boolean;
  decisionIds: readonly string[];
  onOpenDecision: (decisionId: string) => void;
}

export type TaskNodeV2FlowNode = Node<TaskNodeV2Data, "taskNodeV2">;

/** The canonical kind is our vocabulary; the badge is the reader's. */
export const NODE_KIND_LABEL: Record<"root" | "composite" | "leaf" | "integrator", string> = {
  root: "objetivo",
  composite: "coordina",
  leaf: "ejecuta",
  integrator: "integra"
};

export function TaskNodeV2({ data }: NodeProps<TaskNodeV2FlowNode>): React.ReactElement {
  const { node, medal, recovery, selected, dimmed, blocked, decisionIds, onOpenDecision } = data;
  const runtime = nodeRuntimePresentation(node.status, recovery);
  const active = runtime.state === "running" || runtime.state === "repairing" || runtime.state === "repair_queued";
  const visual = active ? activeVisual : medalVisual(medal.state);
  const statusLabel = recovery?.label ?? (medal.badge.length === 0 ? runtime.label : medal.badge);
  return (
    // A plain card, not a named region. The element React Flow focuses is the
    // wrapper around this one and it now carries the whole sentence; naming
    // this too made a screen reader say the node twice in a row.
    <div
      className={[
        "relative w-[246px] rounded-xl border-2 px-4 py-3 shadow-sm",
        "transition-[border-color,box-shadow,opacity,transform] duration-200 motion-reduce:transition-none",
        visual.border,
        visual.surface,
        visual.animation,
        selected ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg)]" : "",
        dimmed ? "opacity-30" : "opacity-100",
        blocked ? "shadow-[0_0_0_3px_color-mix(in_srgb,var(--status-review-fg)_18%,transparent)]" : ""
      ].join(" ")}
    >
      <Handle id="target" type="target" position={Position.Top} className="opacity-0" />
      <Handle id="source" type="source" position={Position.Bottom} className="opacity-0" />
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-micro uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">{NODE_KIND_LABEL[node.kind]}</span>
        {medal.state !== "none" || active ? (
          <span className={`inline-flex max-w-[155px] items-center gap-1 rounded-full px-2 py-1 text-micro font-semibold leading-none ${visual.badge}`}>
            {active
              ? <LoaderCircle aria-hidden className="h-3 w-3 shrink-0 motion-safe:animate-spin motion-reduce:animate-none" />
              : <MedalIcon state={medal.state} />}
            <span className="truncate">{statusLabel}</span>
          </span>
        ) : (
          <span className="text-micro font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">{fallbackStatus(node.status)}</span>
        )}
      </div>
      {/* Not a heading: a card in a canvas is not a section of the document,
          and as an h3 under the page h1 it both broke the outline and made a
          screen reader say the title twice — the focusable wrapper already
          announces it. */}
      <p className="mt-2 text-sm font-semibold leading-5 text-[var(--color-text)]">{node.title}</p>
      <p className="mt-1 line-clamp-2 text-micro leading-4 text-[var(--color-text-muted)]">{node.goal}</p>
      {recovery !== null ? (
        <p role="status" className="mt-2 flex gap-1.5 rounded-lg bg-amber-100/80 p-2 text-micro leading-4 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100">
          <LoaderCircle aria-hidden className="mt-0.5 h-3 w-3 shrink-0 motion-safe:animate-spin motion-reduce:animate-none" />{runtime.detail}
        </p>
      ) : medal.state === "failed" ? (
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
    </div>
  );
}

function MedalIcon({ state }: { state: LifecycleMedal["state"] }): React.ReactElement | null {
  if (state === "candidate") return <GitCommitHorizontal aria-hidden className="h-3 w-3" />;
  if (state === "verified") return <Check aria-hidden className="h-3 w-3" />;
  if (state === "delivered") return <PackageCheck aria-hidden className="h-3 w-3" />;
  if (state === "failed") return <AlertTriangle aria-hidden className="h-3 w-3" />;
  if (state === "evidence_incomplete" || state === "evidence_pending") return <AlertTriangle aria-hidden className="h-3 w-3" />;
  return null;
}

interface NodeVisual {
  border: string;
  surface: string;
  badge: string;
  animation: string;
}

const activeVisual: NodeVisual = {
  border: "border-amber-400",
  surface: "bg-amber-50 dark:bg-amber-950/30",
  badge: "bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-100",
  animation: ""
};

function medalVisual(state: LifecycleMedal["state"]): NodeVisual {
  switch (state) {
    case "candidate": return {
      border: "border-amber-400",
      surface: "bg-[var(--color-surface-raised)]",
      badge: "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-200",
      animation: "motion-safe:animate-pulse motion-reduce:animate-none"
    };
    case "verified": return {
      border: "border-emerald-500",
      surface: "bg-[var(--color-surface-raised)]",
      badge: "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200",
      animation: ""
    };
    case "failed": return {
      border: "border-red-500",
      surface: "bg-[var(--color-surface-raised)]",
      badge: "bg-red-100 text-red-950 dark:bg-red-950/60 dark:text-red-200",
      animation: ""
    };
    case "evidence_incomplete": return {
      border: "border-amber-500",
      surface: "bg-[var(--color-surface-raised)]",
      badge: "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-200",
      animation: ""
    };
    case "evidence_pending": return {
      border: "border-dashed border-slate-400",
      surface: "bg-[var(--color-surface-raised)]",
      badge: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
      animation: ""
    };
    case "stale": return {
      border: "border-dashed border-slate-400",
      surface: "bg-[var(--color-surface-raised)]",
      badge: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
      animation: ""
    };
    case "delivered": return {
      border: "border-violet-500",
      surface: "bg-[var(--color-surface-raised)]",
      badge: "bg-violet-100 text-violet-950 dark:bg-violet-950/60 dark:text-violet-200",
      animation: ""
    };
    default: return { border: "border-[var(--color-border-strong)]", surface: "bg-[var(--color-surface-raised)]", badge: "", animation: "" };
  }
}

/**
 * The status a node shows when it has no lifecycle badge yet — on the card and
 * in the node's accessible name.
 *
 * It only appears before a node has produced anything, which is how it stayed
 * in English through the pass that translated every badge that had one.
 */
export function fallbackStatus(status: RunNodeView["status"]): string {
  return nodeRuntimePresentation(status, null).label;
}
