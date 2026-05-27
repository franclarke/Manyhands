"use client";

import { useId } from "react";
import { MODEL_OPTIONS } from "@/lib/models";

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
}

export function ModelPicker({ value, onChange }: ModelPickerProps): React.ReactElement {
  const labelId = useId();
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <label
        htmlFor={labelId}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "var(--text-3)"
        }}
      >
        Model
      </label>
      <select
        id={labelId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: 30,
          padding: "0 28px 0 10px",
          border: "1px solid var(--border)",
          background: "var(--bg-1)",
          color: "var(--text)",
          borderRadius: 6,
          fontSize: 13,
          fontFamily: "var(--font-sans)",
          appearance: "none",
          cursor: "pointer"
        }}
      >
        {MODEL_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        title="Selection is cosmetic in Fase A — no real provider adapters yet."
        style={{
          fontSize: 9.5,
          fontFamily: "var(--font-mono)",
          letterSpacing: 0.4,
          padding: "2px 6px",
          borderRadius: 4,
          color: "var(--ready)",
          background: "rgba(201,164,92,0.10)",
          border: "1px solid rgba(201,164,92,0.40)",
          textTransform: "uppercase"
        }}
      >
        preview
      </span>
    </div>
  );
}
