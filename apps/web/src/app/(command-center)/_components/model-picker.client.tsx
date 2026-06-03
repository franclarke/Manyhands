"use client";

import { useId } from "react";
import { MODEL_OPTIONS } from "@/lib/models";

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
}

export function ModelPicker({ value, onChange }: ModelPickerProps): React.ReactElement {
  const labelId = useId();
  const listId = `${labelId}-options`;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input
        id={labelId}
        aria-label="Model"
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          minHeight: 36,
          width: 190,
          padding: "0 12px",
          border: "1px solid var(--rule-control)",
          background: "var(--surface)",
          color: "var(--text)",
          borderRadius: 6,
          fontSize: 13.5,
          fontFamily: "var(--font-sans)"
        }}
      />
      <datalist id={listId}>
        {MODEL_OPTIONS.map((option) => (
          <option key={option.id} value={option.id} label={`${option.label} (${option.provider})`} />
        ))}
      </datalist>
      <span
        title="This model id is passed directly to the Gemini CLI."
        style={{
          fontSize: 10.5,
          fontFamily: "var(--font-mono)",
          letterSpacing: 0.4,
          padding: "4px 7px",
          borderRadius: 4,
          color: "var(--status-ready-fg)",
          background: "var(--status-ready-bg)",
          border: "1px solid var(--status-ready-border)",
          textTransform: "uppercase"
        }}
      >
        gemini
      </span>
    </div>
  );
}
