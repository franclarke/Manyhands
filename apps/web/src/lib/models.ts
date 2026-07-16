import {
  EXECUTOR_DESCRIPTORS,
  CLAUDE_CODE_EXECUTOR_ID,
  DEFAULT_EXECUTOR_SELECTION,
  effortsForSelection,
  supportsEffortForSelection
} from "@manyhands/shared";
import type {
  EffortLevel,
  ExecutorCapability,
  ExecutorId,
  ExecutorSelection,
  StageSelection,
  UsageSource
} from "@manyhands/shared";
import type { CapabilitiesResponse } from "@/lib/api-types";

export type { ExecutorCapability as ModelCapability, ExecutorId, ExecutorSelection, StageSelection, EffortLevel };
export { effortsForSelection, supportsEffortForSelection };
export type UsageAvailability = UsageSource;
export type ExecutorOverride = ExecutorSelection;

export interface ExecutorOption {
  id: ExecutorId;
  label: string;
  provider: string;
  usage: UsageAvailability;
  enabled: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  executorId: ExecutorId;
  capabilities: ExecutorCapability[];
  usage: UsageAvailability;
  enabled: boolean;
  /** Whether the model's CLI exposes a reasoning-effort knob (drives the effort UI). Derived from the registry. */
  supportsEffort: boolean;
  /** Declared effort levels, or null when the model has no effort control. Derived from the registry. */
  efforts: readonly EffortLevel[] | null;
  /** Declared default effort, when the model supports effort. */
  defaultEffort?: EffortLevel;
  availabilityMessage?: string;
}

export { CLAUDE_CODE_EXECUTOR_ID, DEFAULT_EXECUTOR_SELECTION };

const ACTIVE_EXECUTOR_DESCRIPTORS = EXECUTOR_DESCRIPTORS.filter((descriptor) => descriptor.enabled);

export const EXECUTOR_OPTIONS: ReadonlyArray<ExecutorOption> = ACTIVE_EXECUTOR_DESCRIPTORS.map((descriptor) => ({
  id: descriptor.id,
  label: descriptor.label,
  provider: descriptor.provider,
  usage: descriptor.usageSource,
  enabled: descriptor.enabled
}));

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = ACTIVE_EXECUTOR_DESCRIPTORS.flatMap((descriptor) =>
  descriptor.models.map((model) => ({
    id: model.id,
    label: model.label,
    provider: descriptor.label,
    executorId: descriptor.id,
    capabilities: model.capabilities,
    usage: model.usageSource,
    enabled: descriptor.enabled,
    supportsEffort: model.efforts !== null && model.efforts.length > 0,
    efforts: model.efforts,
    ...(model.defaultEffort !== undefined ? { defaultEffort: model.defaultEffort } : {})
  }))
);

/** Declared effort levels the UI should offer for a selection, or null when none. */
export function effortLevelsForSelection(selection: ExecutorSelection): readonly EffortLevel[] | null {
  return effortsForSelection(selection);
}

/**
 * Build the canonical StageSelection the UI submits for one stage (U2A-2).
 * Attaches the chosen effort ONLY when the stage's model declares it and lists
 * that level — so the client never sends an effort the backend would reject
 * (e.g. an effort on a Claude model, or a stale level after switching models).
 */
export function stageSelectionForSubmit(
  selection: ExecutorSelection,
  model: ModelOption | undefined,
  effort: EffortLevel
): StageSelection {
  if (model?.supportsEffort === true && model.efforts !== null && model.efforts.includes(effort)) {
    return { executorId: selection.executorId, model: selection.model, effort };
  }
  return { executorId: selection.executorId, model: selection.model };
}

/** Encodes/decodes the "executorId/modelId" selection string used by the picker. */
export function formatSelectionValue(selection: ExecutorSelection): string {
  return `${selection.executorId}/${selection.model}`;
}

export function parseSelectionValue(value: string): ExecutorSelection {
  const [executorId, ...rest] = value.split("/");
  return { executorId: executorId as ExecutorId, model: rest.join("/") };
}

/** The model option for a "executorId/modelId" selection string, if it exists. */
export function modelOptionForValue(
  value: string,
  options: readonly ModelOption[] = MODEL_OPTIONS
): ModelOption | undefined {
  const sel = parseSelectionValue(value);
  return options.find((option) => option.executorId === sel.executorId && option.id === sel.model);
}

/** Convert the server capability/readiness contract into picker options. */
export function modelOptionsFromCapabilities(response: CapabilitiesResponse): ModelOption[] {
  return response.executors.flatMap((executor) => {
    const available = executor.enabled && executor.readiness.status !== "error";
    const availabilityMessage = executor.readiness.checks.find((check) => check.status === "fail")?.message;
    return executor.models.map((model) => ({
      id: model.id,
      label: model.label,
      provider: executor.label,
      executorId: executor.executorId,
      capabilities: [...model.capabilities],
      usage: model.usage,
      enabled: available,
      supportsEffort: model.efforts !== null && model.efforts.length > 0,
      efforts: model.efforts,
      ...(model.defaultEffort !== undefined ? { defaultEffort: model.defaultEffort } : {}),
      ...(availabilityMessage !== undefined ? { availabilityMessage } : {})
    }));
  });
}

export const DEFAULT_MODEL_ID = DEFAULT_EXECUTOR_SELECTION.model;

export function findModel(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((option) => option.id === id);
}

export function findModelForSelection(selection: ExecutorSelection): ModelOption | undefined {
  return MODEL_OPTIONS.find(
    (option) => option.executorId === selection.executorId && option.id === selection.model
  );
}

/** One capability source shared by form controls and request validation. */
export function runtimeCapabilitiesForSelection(selection: ExecutorSelection): {
  selectable: boolean;
  supportsReasoningEffort: boolean;
  capabilities: readonly ExecutorCapability[];
} {
  const model = findModelForSelection(selection);
  return {
    selectable: model?.enabled === true,
    supportsReasoningEffort: model?.enabled === true && model.supportsEffort,
    capabilities: model?.capabilities ?? []
  };
}

export function selectableModelOptions(capability?: ExecutorCapability): ReadonlyArray<ModelOption> {
  return MODEL_OPTIONS.filter((option) => option.enabled && (capability === undefined || option.capabilities.includes(capability)));
}

export function normalizeExecutorOverride(value: unknown): ExecutorOverride | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return { executorId: CLAUDE_CODE_EXECUTOR_ID, model: value };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as { executorId?: unknown; model?: unknown };
  if (
    typeof candidate.executorId !== "string" ||
    typeof candidate.model !== "string" ||
    candidate.model.trim().length === 0
  ) {
    return undefined;
  }
  const selection = { executorId: candidate.executorId as ExecutorId, model: candidate.model };
  return runtimeCapabilitiesForSelection(selection).selectable ? selection : undefined;
}

export function executorLabel(id: ExecutorId): string {
  return EXECUTOR_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
