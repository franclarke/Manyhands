export const CLAUDE_CODE_EXECUTOR_ID = "claude-code-cli";
export const CODEX_EXECUTOR_ID = "codex-cli";
/** Persisted historical selection; disabled and never selectable in product UI. */
export const OPENCODE_EXECUTOR_ID = "opencode-cli";

export const EXECUTOR_IDS = [CLAUDE_CODE_EXECUTOR_ID, CODEX_EXECUTOR_ID, OPENCODE_EXECUTOR_ID] as const;
export type ExecutorId = (typeof EXECUTOR_IDS)[number];
export type ExecutorCapability = "planning" | "execution" | "repair";
export type UsageSource = "reported" | "estimated" | "unavailable";
export interface ExecutorModelDescriptor { id: string; label: string; capabilities: ExecutorCapability[]; usageSource: UsageSource; }
export interface ExecutorDescriptor { id: ExecutorId; label: string; provider: string; binaryEnvVar: string; defaultBinary: string; enabled: boolean; capabilities: ExecutorCapability[]; usageSource: UsageSource; defaultModel: string; models: ExecutorModelDescriptor[]; }
export interface ExecutorSelection { executorId: ExecutorId; model: string; }

const AGENTIC_CAPABILITIES: ExecutorCapability[] = ["execution", "repair"];
export const EXECUTOR_DESCRIPTORS: ExecutorDescriptor[] = [
  { id: CLAUDE_CODE_EXECUTOR_ID, label: "Claude Code CLI", provider: "Anthropic", binaryEnvVar: "MANYHANDS_CLAUDE_BIN", defaultBinary: "claude", enabled: true, capabilities: ["planning", "execution", "repair"], usageSource: "reported", defaultModel: "sonnet", models: [
    { id: "haiku", label: "Claude Haiku", capabilities: AGENTIC_CAPABILITIES, usageSource: "reported" },
    { id: "sonnet", label: "Claude Sonnet", capabilities: ["planning", "execution", "repair"], usageSource: "reported" },
    { id: "opus", label: "Claude Opus", capabilities: AGENTIC_CAPABILITIES, usageSource: "reported" }
  ] },
  { id: CODEX_EXECUTOR_ID, label: "Codex CLI", provider: "OpenAI", binaryEnvVar: "MANYHANDS_CODEX_BIN", defaultBinary: "codex", enabled: true, capabilities: ["planning", "execution", "repair"], usageSource: "unavailable", defaultModel: "gpt-5.5", models: [
    { id: "gpt-5.5", label: "GPT-5.5", capabilities: ["planning", "execution", "repair"], usageSource: "unavailable" },
    { id: "gpt-5.4", label: "GPT-5.4", capabilities: AGENTIC_CAPABILITIES, usageSource: "unavailable" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", capabilities: AGENTIC_CAPABILITIES, usageSource: "unavailable" }
  ] },
  { id: OPENCODE_EXECUTOR_ID, label: "OpenCode CLI", provider: "OpenCode", binaryEnvVar: "MANYHANDS_OPENCODE_BIN", defaultBinary: "opencode", enabled: false, capabilities: AGENTIC_CAPABILITIES, usageSource: "unavailable", defaultModel: "opencode-default", models: [{ id: "opencode-default", label: "OpenCode default", capabilities: AGENTIC_CAPABILITIES, usageSource: "unavailable" }] }
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
