import type {
  ExecutorCapability,
  ExecutorDescriptor,
  ExecutorId,
  ExecutorSelection,
  UsageSource
} from "@manyhands/execution-core";

export type { ExecutorCapability as ModelCapability, ExecutorId, ExecutorSelection };
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
  /** Whether the model's CLI exposes a reasoning-effort knob (drives the effort UI). */
  supportsEffort: boolean;
}

/**
 * Model ids whose executor CLI accepts a reasoning-effort flag. Today only the
 * Codex/GPT-5 family does (`--reasoning-effort`); Gemini CLI 0.44.1 and Claude
 * Code expose only `--model`, so the effort control stays hidden for them.
 */
const EFFORT_CAPABLE_MODEL_IDS = new Set<string>(["gpt-5-codex"]);

export const GEMINI_EXECUTOR_ID = "gemini-cli" satisfies ExecutorId;
export const DEFAULT_EXECUTOR_SELECTION = {
  executorId: GEMINI_EXECUTOR_ID,
  model: "gemini-2.5-pro"
} satisfies ExecutorSelection;

const EXECUTOR_DESCRIPTORS: ExecutorDescriptor[] = [
  {
    id: GEMINI_EXECUTOR_ID,
    label: "Gemini CLI",
    provider: "Gemini",
    binaryEnvVar: "MANYHANDS_GEMINI_BIN",
    defaultBinary: "gemini",
    enabled: true,
    capabilities: ["planning", "execution", "repair"],
    usageSource: "unavailable",
    defaultModel: "gemini-2.5-pro",
    models: [
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        capabilities: ["planning", "execution", "repair"],
        usageSource: "unavailable"
      },
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        capabilities: ["planning", "execution", "repair"],
        usageSource: "unavailable"
      }
    ]
  },
  {
    id: "claude-code-cli",
    label: "Claude Code CLI",
    provider: "Anthropic",
    binaryEnvVar: "MANYHANDS_CLAUDE_BIN",
    defaultBinary: "claude",
    enabled: true,
    capabilities: ["execution", "repair"],
    usageSource: "unavailable",
    defaultModel: "sonnet",
    models: [
      {
        id: "sonnet",
        label: "Claude Sonnet",
        capabilities: ["execution", "repair"],
        usageSource: "unavailable"
      },
      {
        id: "opus",
        label: "Claude Opus",
        capabilities: ["execution", "repair"],
        usageSource: "unavailable"
      }
    ]
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    provider: "OpenAI",
    binaryEnvVar: "MANYHANDS_CODEX_BIN",
    defaultBinary: "codex",
    enabled: false,
    capabilities: ["execution", "repair"],
    usageSource: "unavailable",
    defaultModel: "gpt-5-codex",
    models: [
      {
        id: "gpt-5-codex",
        label: "GPT-5 Codex",
        capabilities: ["execution", "repair"],
        usageSource: "unavailable"
      }
    ]
  },
  {
    id: "opencode-cli",
    label: "OpenCode CLI",
    provider: "OpenCode",
    binaryEnvVar: "MANYHANDS_OPENCODE_BIN",
    defaultBinary: "opencode",
    enabled: false,
    capabilities: ["execution", "repair"],
    usageSource: "unavailable",
    defaultModel: "opencode-default",
    models: [
      {
        id: "opencode-default",
        label: "OpenCode default",
        capabilities: ["execution", "repair"],
        usageSource: "unavailable"
      }
    ]
  }
];

export const EXECUTOR_OPTIONS: ReadonlyArray<ExecutorOption> = EXECUTOR_DESCRIPTORS.map((descriptor) => ({
  id: descriptor.id,
  label: descriptor.label,
  provider: descriptor.provider,
  usage: descriptor.usageSource,
  enabled: descriptor.enabled
}));

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = EXECUTOR_DESCRIPTORS.flatMap((descriptor) =>
  descriptor.models.map((model) => ({
    id: model.id,
    label: model.label,
    provider: descriptor.label,
    executorId: descriptor.id,
    capabilities: model.capabilities,
    usage: model.usageSource,
    enabled: descriptor.enabled,
    supportsEffort: EFFORT_CAPABLE_MODEL_IDS.has(model.id)
  }))
);

/** Encodes/decodes the "executorId/modelId" selection string used by the picker. */
export function formatSelectionValue(selection: ExecutorSelection): string {
  return `${selection.executorId}/${selection.model}`;
}

export function parseSelectionValue(value: string): ExecutorSelection {
  const [executorId, ...rest] = value.split("/");
  return { executorId: executorId as ExecutorId, model: rest.join("/") };
}

/** The model option for a "executorId/modelId" selection string, if it exists. */
export function modelOptionForValue(value: string): ModelOption | undefined {
  const sel = parseSelectionValue(value);
  return MODEL_OPTIONS.find((option) => option.executorId === sel.executorId && option.id === sel.model);
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

export function normalizeExecutorOverride(value: unknown): ExecutorOverride | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return { executorId: GEMINI_EXECUTOR_ID, model: value };
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
  if (!EXECUTOR_DESCRIPTORS.some((descriptor) => descriptor.id === candidate.executorId)) {
    return undefined;
  }
  return { executorId: candidate.executorId as ExecutorId, model: candidate.model };
}

export function executorLabel(id: ExecutorId): string {
  return EXECUTOR_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
