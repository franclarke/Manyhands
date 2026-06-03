export type ExecutorId = "gemini-cli";
export type ModelCapability = "planning" | "execution" | "repair";
export type UsageAvailability = "unavailable" | "reported";

export interface ExecutorOption {
  id: ExecutorId;
  label: string;
  provider: string;
  usage: UsageAvailability;
}

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  executorId: ExecutorId;
  capabilities: ModelCapability[];
  usage: UsageAvailability;
}

export interface ExecutorOverride {
  executorId: ExecutorId;
  model: string;
}

export const GEMINI_EXECUTOR_ID: ExecutorId = "gemini-cli";

export const EXECUTOR_OPTIONS: ReadonlyArray<ExecutorOption> = [
  {
    id: GEMINI_EXECUTOR_ID,
    label: "Gemini CLI",
    provider: "Gemini CLI",
    usage: "unavailable"
  }
];

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = [
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "Gemini CLI",
    executorId: GEMINI_EXECUTOR_ID,
    capabilities: ["planning", "execution", "repair"],
    usage: "unavailable"
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "Gemini CLI",
    executorId: GEMINI_EXECUTOR_ID,
    capabilities: ["planning", "execution", "repair"],
    usage: "unavailable"
  }
];

export const DEFAULT_MODEL_ID = "gemini-2.5-pro";

export function findModel(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((option) => option.id === id);
}

export function normalizeExecutorOverride(value: unknown): ExecutorOverride | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as { executorId?: unknown; model?: unknown };
  if (raw.executorId !== GEMINI_EXECUTOR_ID || typeof raw.model !== "string" || raw.model.trim().length === 0) {
    return undefined;
  }
  return { executorId: GEMINI_EXECUTOR_ID, model: raw.model };
}

export function executorLabel(id: ExecutorId): string {
  return EXECUTOR_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
