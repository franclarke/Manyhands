export interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = [
  { id: "gpt-5", label: "GPT-5", provider: "Codex CLI" },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "Codex CLI" },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "Codex CLI" }
];

export const DEFAULT_MODEL_ID = "gpt-5";

export function findModel(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((option) => option.id === id);
}
