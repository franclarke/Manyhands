"use client";

import { MODEL_OPTIONS } from "@/lib/models";
import type { ModelCapability } from "@/lib/models";

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
  capability?: ModelCapability;
  selectionMode?: "model" | "executor-selection";
}

export function ModelPicker({
  value,
  onChange,
  capability,
  selectionMode = "model"
}: ModelPickerProps): React.ReactElement {
  const options = MODEL_OPTIONS.filter((option) =>
    option.enabled && (capability === undefined || option.capabilities.includes(capability))
  );
  return (
    <select
      aria-label="Modelo"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mh-select h-8 w-full min-w-0 text-[12px]"
    >
      {options.map((option) => (
        <option
          key={`${option.executorId}/${option.id}`}
          value={selectionMode === "executor-selection" ? `${option.executorId}/${option.id}` : option.id}
        >
          {option.label} {selectionMode === "executor-selection" ? `(${option.provider})` : ""}
        </option>
      ))}
    </select>
  );
}
