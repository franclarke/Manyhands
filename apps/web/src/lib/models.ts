export interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Gemini CLI" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Gemini CLI" }
];

export const DEFAULT_MODEL_ID = "gemini-2.5-pro";

export function findModel(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((option) => option.id === id);
}
