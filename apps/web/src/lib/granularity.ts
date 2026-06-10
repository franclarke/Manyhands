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
    helper: "Recomendada. El planner decide cuánto dividir cada rama según su complejidad."
  },
  baja: {
    headline: "Baja",
    helper: "Poca presión por dividir: solo separa las tareas claramente compuestas."
  },
  media: {
    headline: "Media",
    helper: "Balanceada: divide hasta que cada hoja sea una unidad razonablemente ejecutable."
  },
  alta: {
    headline: "Alta",
    helper: "Agresiva: sigue dividiendo hasta que cada hoja sea chica, concreta y verificable."
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
    detail: "recomendada",
    impact: "El planner decide por tarea cuánto dividir. La profundidad de cada rama sigue a su complejidad.",
    recommended: true
  },
  {
    id: "baja",
    label: "Baja",
    detail: "descomposición superficial",
    impact: "Poca presión por dividir: solo se separan las tareas claramente compuestas. Hojas más grandes."
  },
  {
    id: "media",
    label: "Media",
    detail: "descomposición balanceada",
    impact: "Divide hasta que cada hoja sea una unidad razonablemente ejecutable. Las ramas pueden variar en profundidad."
  },
  {
    id: "alta",
    label: "Alta",
    detail: "descomposición agresiva",
    impact: "Sigue dividiendo hasta que las hojas sean chicas, concretas y verificables. Más profunda donde hay complejidad."
  },
  {
    id: "max",
    label: "Máx",
    detail: "agresividad máxima",
    impact: "La división más agresiva — reservada para un modo de backend posterior, no disponible en este MVP.",
    disabled: true,
    disabledReason: "Máx queda reservada para un modo de granularidad de backend posterior."
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
