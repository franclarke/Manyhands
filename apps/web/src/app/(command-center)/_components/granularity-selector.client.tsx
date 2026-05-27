"use client";

import {
  GRANULARITY_DESCRIPTIONS,
  GRANULARITY_LEVELS,
  GRANULARITY_TO_MODE,
  type GranularityLevel
} from "@/lib/granularity";

interface GranularitySelectorProps {
  value: GranularityLevel;
  onChange: (value: GranularityLevel) => void;
}

export function GranularitySelector({ value, onChange }: GranularitySelectorProps): React.ReactElement {
  const description = GRANULARITY_DESCRIPTIONS[value];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap"
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "var(--text-3)"
          }}
        >
          Granularidad
        </span>
        <div
          role="radiogroup"
          aria-label="Granularidad de descomposición"
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            background: "var(--bg-1)",
            borderRadius: 8,
            padding: 3
          }}
        >
          {GRANULARITY_LEVELS.map((level) => {
            const active = value === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(level)}
                style={{
                  border: "none",
                  background: active ? "var(--surface)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-2)",
                  padding: "5px 14px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "background 150ms ease-out, color 150ms ease-out"
                }}
              >
                <span style={{ textTransform: "capitalize" }}>{level}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: active ? "var(--coral)" : "var(--text-3)",
                    letterSpacing: 0.3
                  }}
                >
                  · {GRANULARITY_TO_MODE[level]}
                </span>
              </button>
            );
          })}
        </div>
        <span
          style={{
            fontSize: 12,
            color: "var(--text-2)",
            fontFamily: "var(--font-sans)"
          }}
        >
          <strong style={{ color: "var(--text)" }}>{description.headline}.</strong>{" "}
          {description.helper}
        </span>
      </div>
    </div>
  );
}
