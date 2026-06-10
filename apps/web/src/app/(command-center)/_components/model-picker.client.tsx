"use client";

import { MODEL_OPTIONS } from "@/lib/models";
import type { ModelCapability } from "@/lib/models";

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
  capability?: ModelCapability;
  selectionMode?: "model" | "executor-selection";
  width?: number;
}

export function ModelPicker({
  value,
  onChange,
  capability,
  selectionMode = "model",
  width = 150
}: ModelPickerProps): React.ReactElement {
  const options = MODEL_OPTIONS.filter((option) =>
    option.enabled && (capability === undefined || option.capabilities.includes(capability))
  );
  return (
    <select
      aria-label="Modelo"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mh-select"
      style={{
        minHeight: 32,
        height: 32,
        padding: "0 24px 0 8px",
        fontSize: 12,
        width
      }}
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
