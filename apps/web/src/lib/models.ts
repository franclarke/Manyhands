export interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = [
  { id: "claude-opus-4.7", label: "Claude Opus 4.7", provider: "Anthropic" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", provider: "Anthropic" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5", provider: "Anthropic" },
  { id: "gpt-5", label: "GPT-5", provider: "OpenAI" },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "OpenAI" }
];

export const DEFAULT_MODEL_ID = "claude-opus-4.7";

export function findModel(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((option) => option.id === id);
}
