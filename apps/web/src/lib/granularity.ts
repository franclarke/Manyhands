import type { GranularityMode } from "@/lib/server/runs/schema";

export const GRANULARITY_LEVELS = ["automatica", "baja", "media", "alta"] as const;
export type GranularityLevel = (typeof GRANULARITY_LEVELS)[number];

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
    helper: "Let the planner choose depth for the task."
  },
  baja: {
    headline: "G3 coarse",
    helper: "Few larger nodes. Less coordination overhead, less parallelism."
  },
  media: {
    headline: "G6 balanced",
    helper: "Moderate depth for thesis demos and most feature work."
  },
  alta: {
    headline: "G9 fine",
    helper: "Many atomic nodes. More parallelism, more integration surface."
  }
};

export function toGranularityMode(level: GranularityLevel): GranularityMode {
  return GRANULARITY_TO_MODE[level];
}

export function fromGranularityMode(mode: GranularityMode): GranularityLevel {
  return GRANULARITY_FROM_MODE[mode];
}

export function isGranularityLevel(value: unknown): value is GranularityLevel {
  return typeof value === "string" && (GRANULARITY_LEVELS as readonly string[]).includes(value);
}
