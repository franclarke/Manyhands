import type { RunStatusKey } from "@/lib/api-types";
// Status vocabularies for run graph projections (formerly graph-view-model).
export type GraphNodeStatus =
  | "planned"
  | "ready"
  | "running"
  | "gated"
  | "done"
  | "failed"
  | "blocked"
  | "generating"
  | "needs_review"
  | "approved"
  | "integrated";

export type GraphRiskLevel = "low" | "medium" | "high" | "blocking";

/**
 * Single source of truth for status → color mapping.
 *
 * Two vocabularies live here on purpose:
 *
 * 1. Domain colors (`GRAPH_STATUS_COLOR`, `RISK_COLOR`): keyed by the canonical
 *    `GraphNodeStatus` / `GraphRiskLevel` enums. These replace the per-component
 *    `STATUS_COLOR`/`RISK_COLOR` maps that used to be duplicated across
 *    the run views. Values are
 *    identical to the previous ones — no visual change.
 *
 * 2. UX presentation status (`UiStatus`, `STATUS_META`): the collapsed,
 *    user-facing state vocabulary (idle / planning / pending / running / …) that
 *    new components (badges, phase chrome, summary) consume. It is derived from
 *    the canonical run/node statuses via `nodeUiStatus` / `runUiStatus`; it never
 *    replaces the canonical domain enums (D1–D10 untouched).
 */

// ── 1. Domain colors (canonical node/risk status → CSS var) ──────────────────

export const GRAPH_STATUS_COLOR: Record<GraphNodeStatus, string> = {
  planned: "var(--planned)",
  ready: "var(--ready)",
  running: "var(--running)",
  gated: "var(--status-review-fg)",
  done: "var(--done)",
  failed: "var(--error)",
  blocked: "var(--status-blocked-fg)",
  generating: "var(--running)",
  needs_review: "var(--status-review-fg)",
  approved: "var(--ready)",
  integrated: "var(--status-integrated-fg)"
};

export const RISK_COLOR: Record<GraphRiskLevel, string> = {
  low: "var(--risk-low)",
  medium: "var(--risk-medium)",
  high: "var(--risk-high)",
  blocking: "var(--risk-blocking)"
};

export function graphStatusColor(status: GraphNodeStatus): string {
  return GRAPH_STATUS_COLOR[status];
}

export function riskColor(level: GraphRiskLevel): string {
  return RISK_COLOR[level];
}

/** Run-level status color — single source (replaces duplicated run STATUS_COLOR maps). */
export const RUN_STATUS_COLOR: Record<RunStatusKey, string> = {
  created: "var(--planned)",
  generating: "var(--running)",
  paused: "var(--ready)",
  needs_review: "var(--ready)",
  approved: "var(--done)",
  running: "var(--running)",
  completed: "var(--done)",
  completed_with_accepted: "var(--done)",
  partial: "var(--status-review-fg)",
  unverified: "var(--status-review-fg)",
  needs_delivery: "var(--ready)",
  failed_artifact: "var(--error)",
  failed_delivery: "var(--error)",
  cancelling: "var(--error)",
  failed: "var(--error)",
  interrupted: "var(--ready)"
};

export function runStatusColor(status: RunStatusKey): string {
  return RUN_STATUS_COLOR[status];
}

// ── 2. UX presentation status (UiStatus + semantic tokens) ───────────────────

export type UiStatus =
  | "idle"
  | "planning"
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "completed_with_accepted"
  | "failed"
  | "blocked"
  | "needs_review"
  | "integrating"
  | "integrated"
  | "conflict"
  | "skipped";

export interface StatusMeta {
  /** Human-facing label. */
  label: string;
  /** Foreground/accent color token (`--status-*-fg`). */
  fg: string;
  /** Tinted background token (`--status-*-bg`). */
  bg: string;
  /** Tinted border token (`--status-*-border`). */
  border: string;
  /** Whether the state should animate (running / integrating). */
  pulse: boolean;
  /**
   * Not-started states (idle / pending / skipped) render a HOLLOW dot — the same
   * "empty = no arrancado" shape the DAG node uses. Everything else is filled.
   */
  hollow: boolean;
}

export const STATUS_META: Record<UiStatus, StatusMeta> = {
  idle: {
    label: "Inactivo",
    fg: "var(--status-idle-fg)",
    bg: "var(--status-idle-bg)",
    border: "var(--status-idle-border)",
    pulse: false,
    hollow: true
  },
  planning: {
    label: "Planificando",
    fg: "var(--status-planning-fg)",
    bg: "var(--status-planning-bg)",
    border: "var(--status-planning-border)",
    pulse: true,
    hollow: false
  },
  pending: {
    label: "Pendiente",
    fg: "var(--status-pending-fg)",
    bg: "var(--status-pending-bg)",
    border: "var(--status-pending-border)",
    pulse: false,
    hollow: true
  },
  ready: {
    label: "Listo",
    fg: "var(--status-ready-fg)",
    bg: "var(--status-ready-bg)",
    border: "var(--status-ready-border)",
    pulse: false,
    hollow: false
  },
  running: {
    label: "Ejecutando",
    fg: "var(--status-running-fg)",
    bg: "var(--status-running-bg)",
    border: "var(--status-running-border)",
    pulse: true,
    hollow: false
  },
  completed: {
    label: "Completado",
    fg: "var(--status-completed-fg)",
    bg: "var(--status-completed-bg)",
    border: "var(--status-completed-border)",
    pulse: false,
    hollow: false
  },
  completed_with_accepted: {
    // Distinct label so the badge never claims a fully-clean run; reuses the
    // success color tokens because the run did deliver a result (P2b).
    label: "Completado con reservas",
    fg: "var(--status-completed-fg)",
    bg: "var(--status-completed-bg)",
    border: "var(--status-completed-border)",
    pulse: false,
    hollow: false
  },
  failed: {
    label: "Fallido",
    fg: "var(--status-failed-fg)",
    bg: "var(--status-failed-bg)",
    border: "var(--status-failed-border)",
    pulse: false,
    hollow: false
  },
  blocked: {
    label: "Bloqueado",
    fg: "var(--status-blocked-fg)",
    bg: "var(--status-blocked-bg)",
    border: "var(--status-blocked-border)",
    pulse: false,
    hollow: false
  },
  needs_review: {
    label: "Para revisar",
    fg: "var(--status-review-fg)",
    bg: "var(--status-review-bg)",
    border: "var(--status-review-border)",
    pulse: false,
    hollow: false
  },
  integrating: {
    label: "Integrando",
    fg: "var(--status-integrating-fg)",
    bg: "var(--status-integrating-bg)",
    border: "var(--status-integrating-border)",
    pulse: true,
    hollow: false
  },
  integrated: {
    label: "Integrado",
    fg: "var(--status-integrated-fg)",
    bg: "var(--status-integrated-bg)",
    border: "var(--status-integrated-border)",
    pulse: false,
    hollow: false
  },
  conflict: {
    label: "Conflicto",
    fg: "var(--status-conflict-fg)",
    bg: "var(--status-conflict-bg)",
    border: "var(--status-conflict-border)",
    pulse: false,
    hollow: false
  },
  skipped: {
    label: "Omitido",
    fg: "var(--status-skipped-fg)",
    bg: "var(--status-skipped-bg)",
    border: "var(--status-skipped-border)",
    pulse: false,
    hollow: true
  }
};

export interface NodeUiStatusContext {
  /** Node is an integration/integrator node. */
  integrator?: boolean;
  /** Node currently has an unresolved integration conflict. */
  conflict?: boolean;
}

/** Map a canonical node status (+ context) to the UX-facing `UiStatus`. */
export function nodeUiStatus(status: GraphNodeStatus, ctx: NodeUiStatusContext = {}): UiStatus {
  if (ctx.conflict === true) {
    return "conflict";
  }

  const active = status === "running" || status === "generating";
  if (ctx.integrator === true && active) {
    return "integrating";
  }

  switch (status) {
    case "planned":
      return "pending";
    case "ready":
    case "approved":
      return "ready";
    case "running":
    case "generating":
      return "running";
    case "gated":
    case "needs_review":
      return "needs_review";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "done":
      return "completed";
    case "integrated":
      return "integrated";
    default:
      return "pending";
  }
}

/** Map a run-level status to the UX-facing `UiStatus` (for run badge / chrome). */
export function runUiStatus(status: RunStatusKey): UiStatus {
  switch (status) {
    case "created":
      return "idle";
    case "generating":
      return "planning";
    case "needs_review":
      return "needs_review";
    case "approved":
      return "ready";
    case "paused":
      // Paused = a gate/question is waiting on the human; painting it as
      // "Ejecutando" hid the pause in the postmortem run's header badge.
      return "needs_review";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "completed_with_accepted":
      return "completed_with_accepted";
    case "partial":
    case "unverified":
      return "needs_review";
    case "needs_delivery":
      return "ready";
    case "failed_artifact":
    case "failed_delivery":
      return "failed";
    case "failed":
      return "failed";
    case "cancelling":
      // Cancellation issued but not yet verified terminal (B-005): survivors
      // block the transition to `interrupted`, so the run needs attention.
      return "blocked";
    case "interrupted":
      return "skipped";
    default:
      return "idle";
  }
}

export function statusMeta(status: UiStatus): StatusMeta {
  return STATUS_META[status];
}
