export const CLAUDE_CODE_EXECUTOR_ID = "claude-code-cli";
export const CODEX_EXECUTOR_ID = "codex-cli";
/** Persisted historical selection; disabled and never selectable in product UI. */
export const OPENCODE_EXECUTOR_ID = "opencode-cli";

export const EXECUTOR_IDS = [CLAUDE_CODE_EXECUTOR_ID, CODEX_EXECUTOR_ID, OPENCODE_EXECUTOR_ID] as const;
export type ExecutorId = (typeof EXECUTOR_IDS)[number];
export type ExecutorCapability = "planning" | "execution" | "repair";
export type UsageSource = "reported" | "estimated" | "unavailable";

/**
 * Canonical reasoning-effort domain. This is the ONE definition of the effort
 * levels ManyHands understands; every consumer (execution-core schemas, the
 * decomposer CLI adapters, the run-config API types and the effort UI) derives
 * from it instead of re-declaring the union. Client-safe (no runtime deps).
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
const EFFORT_LEVEL_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);
export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && EFFORT_LEVEL_SET.has(value);
}

const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set<ExecutorCapability>(["planning", "execution", "repair"]);

export interface ExecutorModelDescriptor {
  id: string;
  label: string;
  capabilities: ExecutorCapability[];
  usageSource: UsageSource;
  /**
   * Reasoning-effort levels this model's CLI honours, or `null` when the model
   * exposes no effort knob. `null` (never `[]`) means "unsupported" so the
   * distinction between "no control" and "empty control" is never ambiguous.
   */
  efforts: readonly EffortLevel[] | null;
  /** Default effort; MUST be a member of `efforts`. Absent when `efforts` is null. */
  defaultEffort?: EffortLevel;
}
export interface ExecutorDescriptor { id: ExecutorId; label: string; provider: string; binaryEnvVar: string; defaultBinary: string; enabled: boolean; capabilities: ExecutorCapability[]; usageSource: UsageSource; defaultModel: string; models: ExecutorModelDescriptor[]; }
export interface ExecutorSelection { executorId: ExecutorId; model: string; }
/**
 * A complete, self-contained selection for one pipeline stage (planning /
 * execution / repair): executor + model + the reasoning effort that stage runs
 * at. `effort` is present only for models that declare effort support; a stage
 * on an effort-less model carries no `effort`. Superset of {@link ExecutorSelection}.
 */
export interface StageSelection { executorId: ExecutorId; model: string; effort?: EffortLevel; }

const AGENTIC_CAPABILITIES: ExecutorCapability[] = ["execution", "repair"];
// Codex CLI accepts `model_reasoning_effort` across the whole level range; the
// injected product default is medium (see withDefaultReasoningEffort). Claude
// Code exposes only `--model`, so its models declare `efforts: null`.
const CODEX_EFFORTS: readonly EffortLevel[] = EFFORT_LEVELS;
const CODEX_DEFAULT_EFFORT: EffortLevel = "medium";
export const EXECUTOR_DESCRIPTORS: ExecutorDescriptor[] = [
  { id: CLAUDE_CODE_EXECUTOR_ID, label: "Claude Code CLI", provider: "Anthropic", binaryEnvVar: "MANYHANDS_CLAUDE_BIN", defaultBinary: "claude", enabled: true, capabilities: ["planning", "execution", "repair"], usageSource: "reported", defaultModel: "sonnet", models: [
    { id: "haiku", label: "Claude Haiku", capabilities: AGENTIC_CAPABILITIES, usageSource: "reported", efforts: null },
    { id: "sonnet", label: "Claude Sonnet", capabilities: ["planning", "execution", "repair"], usageSource: "reported", efforts: null },
    { id: "opus", label: "Claude Opus", capabilities: AGENTIC_CAPABILITIES, usageSource: "reported", efforts: null }
  ] },
  { id: CODEX_EXECUTOR_ID, label: "Codex CLI", provider: "OpenAI", binaryEnvVar: "MANYHANDS_CODEX_BIN", defaultBinary: "codex", enabled: true, capabilities: ["planning", "execution", "repair"], usageSource: "unavailable", defaultModel: "gpt-5.5", models: [
    { id: "gpt-5.5", label: "GPT-5.5", capabilities: ["planning", "execution", "repair"], usageSource: "unavailable", efforts: CODEX_EFFORTS, defaultEffort: CODEX_DEFAULT_EFFORT },
    { id: "gpt-5.4", label: "GPT-5.4", capabilities: AGENTIC_CAPABILITIES, usageSource: "unavailable", efforts: CODEX_EFFORTS, defaultEffort: CODEX_DEFAULT_EFFORT },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", capabilities: AGENTIC_CAPABILITIES, usageSource: "unavailable", efforts: CODEX_EFFORTS, defaultEffort: CODEX_DEFAULT_EFFORT }
  ] },
  { id: OPENCODE_EXECUTOR_ID, label: "OpenCode CLI", provider: "OpenCode", binaryEnvVar: "MANYHANDS_OPENCODE_BIN", defaultBinary: "opencode", enabled: false, capabilities: AGENTIC_CAPABILITIES, usageSource: "unavailable", defaultModel: "opencode-default", models: [{ id: "opencode-default", label: "OpenCode default", capabilities: AGENTIC_CAPABILITIES, usageSource: "unavailable", efforts: null }] }
];
export const DEFAULT_EXECUTOR_SELECTION: ExecutorSelection = { executorId: CLAUDE_CODE_EXECUTOR_ID, model: "sonnet" };
const EXECUTOR_ID_SET = new Set<string>(EXECUTOR_IDS);
export function getExecutorDescriptor(executorId: ExecutorId): ExecutorDescriptor { const descriptor = EXECUTOR_DESCRIPTORS.find((entry) => entry.id === executorId); if (descriptor === undefined) throw new Error(`Unknown executor "${executorId}"`); return descriptor; }
export function findExecutorDescriptor(executorId: string): ExecutorDescriptor | undefined { return EXECUTOR_ID_SET.has(executorId) ? getExecutorDescriptor(executorId as ExecutorId) : undefined; }
export function findExecutorModel(selection: ExecutorSelection): ExecutorModelDescriptor | undefined { return getExecutorDescriptor(selection.executorId).models.find((model) => model.id === selection.model); }
export function isExecutorSelection(value: unknown): value is ExecutorSelection { if (typeof value !== "object" || value === null || Array.isArray(value)) return false; const candidate = value as { executorId?: unknown; model?: unknown }; return typeof candidate.executorId === "string" && EXECUTOR_ID_SET.has(candidate.executorId) && typeof candidate.model === "string" && candidate.model.trim().length > 0; }
export function normalizeExecutorSelection(value: unknown): ExecutorSelection | undefined { if (typeof value === "string" && value.trim().length > 0) { const model = value.trim(); const matches = EXECUTOR_DESCRIPTORS.flatMap((descriptor) => descriptor.models.filter((candidate) => candidate.id === model).map((candidate) => ({ executorId: descriptor.id, model: candidate.id }))); return matches.length === 1 ? matches[0] : { executorId: CLAUDE_CODE_EXECUTOR_ID, model }; } return isExecutorSelection(value) ? { executorId: value.executorId, model: value.model } : undefined; }
export function resolveLegacyModelSelection(model: string | undefined): ExecutorSelection { return normalizeExecutorSelection(model) ?? DEFAULT_EXECUTOR_SELECTION; }
export function usageSourceForSelection(selection: ExecutorSelection): UsageSource { return findExecutorModel(selection)?.usageSource ?? getExecutorDescriptor(selection.executorId).usageSource; }

/** Declared effort levels for a selection, or null when the model exposes no effort knob. */
export function effortsForSelection(selection: ExecutorSelection): readonly EffortLevel[] | null {
  return findExecutorModel(selection)?.efforts ?? null;
}
/** Whether the selected model declares any configurable reasoning effort. */
export function supportsEffortForSelection(selection: ExecutorSelection): boolean {
  const efforts = findExecutorModel(selection)?.efforts;
  return efforts !== null && efforts !== undefined && efforts.length > 0;
}
/** Declared default effort for a selection, if the model has one. */
export function defaultEffortForSelection(selection: ExecutorSelection): EffortLevel | undefined {
  return findExecutorModel(selection)?.defaultEffort;
}

/**
 * Static integrity of the declarative registry. Pure and dependency-free so it
 * can run at module load (below) AND be exercised with hand-built descriptors
 * in tests. This checks *declared* consistency only — never CLI or account
 * availability, which are separate runtime concerns.
 */
export function collectExecutorRegistryErrors(descriptors: readonly ExecutorDescriptor[] = EXECUTOR_DESCRIPTORS): string[] {
  const errors: string[] = [];
  for (const descriptor of descriptors) {
    for (const capability of descriptor.capabilities) {
      if (!KNOWN_CAPABILITIES.has(capability)) errors.push(`${descriptor.id}: unknown capability "${capability}"`);
    }
    const seen = new Set<string>();
    for (const model of descriptor.models) {
      if (seen.has(model.id)) errors.push(`${descriptor.id}: duplicate model id "${model.id}"`);
      seen.add(model.id);
      for (const capability of model.capabilities) {
        if (!KNOWN_CAPABILITIES.has(capability)) errors.push(`${descriptor.id}/${model.id}: unknown capability "${capability}"`);
      }
      if (model.efforts === null) {
        if (model.defaultEffort !== undefined) {
          errors.push(`${descriptor.id}/${model.id}: model without efforts cannot declare a defaultEffort`);
        }
      } else {
        if (model.efforts.length === 0) {
          errors.push(`${descriptor.id}/${model.id}: efforts must be null (not an empty array) when unsupported`);
        }
        for (const effort of model.efforts) {
          if (!EFFORT_LEVEL_SET.has(effort)) errors.push(`${descriptor.id}/${model.id}: effort "${effort}" is not a canonical EffortLevel`);
        }
        if (model.defaultEffort !== undefined && !model.efforts.includes(model.defaultEffort)) {
          errors.push(`${descriptor.id}/${model.id}: defaultEffort "${model.defaultEffort}" is not in the model's efforts`);
        }
      }
    }
    if (!descriptor.models.some((model) => model.id === descriptor.defaultModel)) {
      errors.push(`${descriptor.id}: defaultModel "${descriptor.defaultModel}" is not among its models`);
    }
  }
  return errors;
}

/** Throws if the registry violates its declared-integrity invariants. */
export function assertValidExecutorRegistry(descriptors: readonly ExecutorDescriptor[] = EXECUTOR_DESCRIPTORS): void {
  const errors = collectExecutorRegistryErrors(descriptors);
  if (errors.length > 0) throw new Error(`Invalid executor registry:\n${errors.join("\n")}`);
}

// Fail fast on a mis-declared registry at import time (dev + build). The
// canonical registry above is valid, so this is a no-op in production.
assertValidExecutorRegistry();
