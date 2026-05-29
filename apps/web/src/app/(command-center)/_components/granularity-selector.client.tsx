"use client";

import {
  GRANULARITY_DESCRIPTIONS,
  GRANULARITY_LEVELS,
  type GranularityLevel
} from "@/lib/granularity";

interface GranularitySelectorProps {
  value: GranularityLevel;
  onChange: (value: GranularityLevel) => void;
}

const LABELS: Record<GranularityLevel, { label: string; coord: string }> = {
  automatica: { label: "Auto", coord: "system" },
  baja: { label: "G3", coord: "coarse" },
  media: { label: "G6", coord: "balanced" },
  alta: { label: "G9", coord: "fine" }
};

export function GranularitySelector({ value, onChange }: GranularitySelectorProps): React.ReactElement {
  const description = GRANULARITY_DESCRIPTIONS[value];
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Granularity"
        style={{
          display: "inline-flex",
          padding: 2,
          border: "1px solid var(--rule)",
          borderRadius: 7
        }}
      >
        {GRANULARITY_LEVELS.map((level) => {
          const active = value === level;
          const label = LABELS[level];
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(level)}
              title={description.helper}
              style={{
                height: 26,
                border: "none",
                background: active ? "rgba(229,222,204,0.06)" : "transparent",
                color: active ? "var(--text)" : "var(--text-2)",
                borderRadius: 5,
                padding: "0 10px",
                fontSize: 12,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6
              }}
            >
              <span>{label.label}</span>
              <span className="mh-mono" style={{ fontSize: 9.5, color: active ? "var(--copper)" : "var(--text-3)" }}>
                {label.coord}
              </span>
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>
        <strong style={{ color: "var(--text)" }}>{description.headline}</strong>
      </span>
    </>
  );
}
