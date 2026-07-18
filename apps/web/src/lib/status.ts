import type { RunStatusKey } from "@/lib/api-types";
import type { NodeExecutionStatus } from "@/lib/run-model/types";

export type GraphRiskLevel = "low" | "medium" | "high" | "blocking";

export type UiStatus =
  | "idle"
  | "planning"
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "attention"
  | "delivering"
  | "skipped";

export interface StatusMeta {
  label: string;
  fg: string;
  bg: string;
  border: string;
  pulse: boolean;
  hollow: boolean;
}

export const STATUS_META: Record<UiStatus, StatusMeta> = {
  idle: meta("Inactivo", "idle", false, true),
  planning: meta("Planificando", "planning", true, false),
  pending: meta("Pendiente", "pending", false, true),
  ready: meta("Listo", "ready", false, false),
  running: meta("Ejecutando", "running", true, false),
  completed: meta("Completado", "completed", false, false),
  failed: meta("Falló", "failed", false, false),
  blocked: meta("Bloqueado", "blocked", false, false),
  attention: {
    label: "Requiere atención",
    fg: "var(--status-review-fg)",
    bg: "var(--status-review-bg)",
    border: "var(--status-review-border)",
    pulse: false,
    hollow: false
  },
  delivering: meta("Publicando", "integrating", true, false),
  skipped: meta("Interrumpido", "skipped", false, true)
};

export const RUN_STATUS_COLOR: Record<RunStatusKey, string> = {
  planning: STATUS_META.planning.fg,
  needs_approval: STATUS_META.attention.fg,
  running: STATUS_META.running.fg,
  waiting_for_input: STATUS_META.attention.fg,
  paused: STATUS_META.ready.fg,
  cancelling: STATUS_META.blocked.fg,
  interrupted: STATUS_META.skipped.fg,
  result_ready: STATUS_META.ready.fg,
  delivering: STATUS_META.delivering.fg,
  completed: STATUS_META.completed.fg,
  failed: STATUS_META.failed.fg
};

export const RISK_COLOR: Record<GraphRiskLevel, string> = {
  low: "var(--risk-low)",
  medium: "var(--risk-medium)",
  high: "var(--risk-high)",
  blocking: "var(--risk-blocking)"
};

export function runUiStatus(status: RunStatusKey): UiStatus {
  switch (status) {
    case "planning": return "planning";
    case "needs_approval":
    case "waiting_for_input": return "attention";
    case "running": return "running";
    case "paused":
    case "result_ready": return "ready";
    case "cancelling": return "blocked";
    case "interrupted": return "skipped";
    case "delivering": return "delivering";
    case "completed": return "completed";
    case "failed": return "failed";
  }
}

export function nodeUiStatus(status: NodeExecutionStatus): UiStatus {
  switch (status) {
    case "pending": return "pending";
    case "ready": return "ready";
    case "running": return "running";
    case "waiting": return "attention";
    case "succeeded": return "completed";
    case "failed": return "failed";
    case "stale": return "skipped";
  }
}

export function runStatusColor(status: RunStatusKey): string { return RUN_STATUS_COLOR[status]; }
export function riskColor(level: GraphRiskLevel): string { return RISK_COLOR[level]; }
export function statusMeta(status: UiStatus): StatusMeta { return STATUS_META[status]; }

function meta(label: string, token: string, pulse: boolean, hollow: boolean): StatusMeta {
  return {
    label,
    fg: `var(--status-${token}-fg)`,
    bg: `var(--status-${token}-bg)`,
    border: `var(--status-${token}-border)`,
    pulse,
    hollow
  };
}
