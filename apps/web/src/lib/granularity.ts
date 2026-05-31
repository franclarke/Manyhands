import type { GranularityMode } from "@/lib/server/runs/schema";

export const GRANULARITY_LEVELS = ["automatica", "baja", "media", "alta"] as const;
export type GranularityLevel = (typeof GRANULARITY_LEVELS)[number];
export type GranularityDisplayId = GranularityLevel | "max";

export const GRANULARITY_TO_MODE: Record<GranularityLevel, GranularityMode> = {
  automatica: "auto",
  baja: "coarse",
  media: "balanced",
  alta: "fine"
};

export const GRANULARITY_FROM_MODE: Record<GranularityMode, GranularityLevel> = {
  auto: "automatica",
  coarse: "baja",
  balanced: "media",
  fine: "alta"
};

export interface GranularityDescription {
  headline: string;
  helper: string;
}

export const GRANULARITY_DESCRIPTIONS: Record<GranularityLevel, GranularityDescription> = {
  automatica: {
    headline: "Auto",
    helper: "Recommended. The planner chooses a decomposition depth for the task."
  },
  baja: {
    headline: "Low",
    helper: "Fewer larger tasks. Less coordination overhead, less parallelism."
  },
  media: {
    headline: "Medium",
    helper: "Balanced decomposition for most feature work."
  },
  alta: {
    headline: "High",
    helper: "More focused subtasks. More parallelism, more integration surface."
  }
};

export interface GranularityDisplayOption {
  id: GranularityDisplayId;
  label: string;
  detail: string;
  impact: string;
  recommended?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export const GRANULARITY_DISPLAY_OPTIONS: readonly GranularityDisplayOption[] = [
  {
    id: "automatica",
    label: "Auto",
    detail: "recommended",
    impact: "Expected: planner-selected nodes · adaptive levels · review effort depends on task",
    recommended: true
  },
  {
    id: "baja",
    label: "Low",
    detail: "fewer larger tasks",
    impact: "Expected: ~4 nodes · 1-2 levels · fewer parallel batches"
  },
  {
    id: "media",
    label: "Medium",
    detail: "balanced decomposition",
    impact: "Expected: ~7 nodes · 2 levels · balanced review and execution"
  },
  {
    id: "alta",
    label: "High",
    detail: "more focused subtasks",
    impact: "Expected: ~9 nodes · 2-3 levels · parallel batches likely"
  },
  {
    id: "max",
    label: "Max",
    detail: "deep decomposition, more review",
    impact: "Expected: deeper graph · more review · not available in this MVP",
    disabled: true,
    disabledReason: "Max is reserved for a later backend granularity mode."
  }
];

export function toGranularityMode(level: GranularityLevel): GranularityMode {
  return GRANULARITY_TO_MODE[level];
}

export function fromGranularityMode(mode: GranularityMode): GranularityLevel {
  return GRANULARITY_FROM_MODE[mode];
}

export function isGranularityLevel(value: unknown): value is GranularityLevel {
  return typeof value === "string" && (GRANULARITY_LEVELS as readonly string[]).includes(value);
}

export function granularityOption(id: GranularityDisplayId): GranularityDisplayOption {
  return GRANULARITY_DISPLAY_OPTIONS.find((option) => option.id === id) ?? GRANULARITY_DISPLAY_OPTIONS[0]!;
}

export function granularityImpactForLevel(level: GranularityLevel): string {
  return granularityOption(level).impact;
}

export function granularityLabelForMode(mode: GranularityMode): string {
  return granularityOption(fromGranularityMode(mode)).label;
}

export function granularityDetailForMode(mode: GranularityMode): string {
  return granularityOption(fromGranularityMode(mode)).detail;
}
