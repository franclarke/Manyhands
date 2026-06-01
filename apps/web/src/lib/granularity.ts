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
    helper: "Recommended. The planner decides how far to split each branch by its complexity."
  },
  baja: {
    headline: "Low",
    helper: "Low pressure to split: only divide tasks that are clearly composite."
  },
  media: {
    headline: "Medium",
    helper: "Balanced: split until each leaf is a reasonably executable unit."
  },
  alta: {
    headline: "High",
    helper: "Aggressive: keep splitting until every leaf is small, concrete and verifiable."
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
    impact: "The planner decides per task how far to split. Branch depth follows complexity.",
    recommended: true
  },
  {
    id: "baja",
    label: "Low",
    detail: "shallow decomposition",
    impact: "Low pressure to split: only clearly-composite tasks are divided. Larger leaves."
  },
  {
    id: "media",
    label: "Medium",
    detail: "balanced decomposition",
    impact: "Splits until each leaf is a reasonably executable unit. Branches may differ in depth."
  },
  {
    id: "alta",
    label: "High",
    detail: "aggressive decomposition",
    impact: "Keeps splitting until leaves are small, concrete and verifiable. Deeper where complex."
  },
  {
    id: "max",
    label: "Max",
    detail: "maximum aggressiveness",
    impact: "Most aggressive splitting — reserved for a later backend mode, not available in this MVP.",
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
