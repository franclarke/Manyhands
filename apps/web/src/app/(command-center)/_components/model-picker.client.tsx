"use client";

import { MODEL_OPTIONS } from "@/lib/models";

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
}

export function ModelPicker({ value, onChange }: ModelPickerProps): React.ReactElement {
  return (
    <select
      aria-label="Model"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mh-select"
      style={{
        minHeight: 32,
        height: 32,
        padding: "0 24px 0 8px",
        fontSize: 12,
        width: 150
      }}
    >
      {MODEL_OPTIONS.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
