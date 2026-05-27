import type { DecompositionMode } from "@manyhands/core";

export const GRANULARITY_LEVELS = ["baja", "media", "alta"] as const;
export type GranularityLevel = (typeof GRANULARITY_LEVELS)[number];

export const GRANULARITY_TO_MODE: Record<GranularityLevel, DecompositionMode> = {
  baja: "coarse",
  media: "balanced",
  alta: "fine"
};

export const GRANULARITY_FROM_MODE: Record<DecompositionMode, GranularityLevel> = {
  coarse: "baja",
  balanced: "media",
  fine: "alta"
};

export interface GranularityDescription {
  headline: string;
  helper: string;
}

export const GRANULARITY_DESCRIPTIONS: Record<GranularityLevel, GranularityDescription> = {
  baja: {
    headline: "Pocos nodos grandes",
    helper: "Árbol superficial. Útil para spikes, validaciones rápidas o tareas atómicas."
  },
  media: {
    headline: "Balance",
    helper: "Profundidad y delegabilidad razonables. Default recomendado."
  },
  alta: {
    headline: "Muchos nodos atómicos",
    helper: "Descomposición profunda. Más subagentes paralelos, más overhead de coordinación."
  }
};

export function toDecompositionMode(level: GranularityLevel): DecompositionMode {
  return GRANULARITY_TO_MODE[level];
}

export function fromDecompositionMode(mode: DecompositionMode): GranularityLevel {
  return GRANULARITY_FROM_MODE[mode];
}

export function isGranularityLevel(value: unknown): value is GranularityLevel {
  return typeof value === "string" && (GRANULARITY_LEVELS as readonly string[]).includes(value);
}
