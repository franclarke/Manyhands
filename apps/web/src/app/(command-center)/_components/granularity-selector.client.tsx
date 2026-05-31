"use client";

import {
  GRANULARITY_DISPLAY_OPTIONS,
  granularityImpactForLevel,
  isGranularityLevel,
  type GranularityLevel
} from "@/lib/granularity";

interface GranularitySelectorProps {
  value: GranularityLevel;
  onChange: (value: GranularityLevel) => void;
}

export function GranularitySelector({ value, onChange }: GranularitySelectorProps): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      <div
        role="radiogroup"
        aria-label="Granularity"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(116px, 1fr))",
          gap: 8,
          width: "100%"
        }}
      >
        {GRANULARITY_DISPLAY_OPTIONS.map((option) => {
          const active = value === option.id;
          const level = isGranularityLevel(option.id) ? option.id : null;
          const selectable = level !== null && option.disabled !== true;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-disabled={!selectable}
              onClick={() => {
                if (selectable && level !== null) onChange(level);
              }}
              title={option.disabledReason ?? option.detail}
              style={{
                minHeight: 68,
                border: `1px solid ${active ? "var(--copper)" : "var(--rule)"}`,
                background: active ? "rgba(180,113,72,0.10)" : "rgba(229,222,204,0.022)",
                color: option.disabled ? "var(--text-4)" : active ? "var(--text)" : "var(--text-2)",
                borderRadius: "var(--r-lg)",
                padding: "10px 11px",
                cursor: selectable ? "pointer" : "not-allowed",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 6,
                textAlign: "left",
                opacity: option.disabled ? 0.55 : 1
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: active ? "var(--copper-hi)" : "inherit" }}>
                {option.label}
              </span>
              <span style={{ fontSize: 11.5, lineHeight: 1.35 }}>
                {option.detail}
              </span>
            </button>
          );
        })}
      </div>
      <div
        style={{
          border: "1px solid var(--rule)",
          background: "rgba(15,16,18,0.42)",
          borderRadius: "var(--r-md)",
          padding: "8px 10px",
          color: "var(--text-2)",
          fontSize: 12.5
        }}
      >
        {granularityImpactForLevel(value)}
      </div>
    </div>
  );
}
