"use client";

export type EffortLevel = "low" | "medium" | "high";

export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high"];

const LABELS: Record<EffortLevel, string> = {
  low: "Rápido",
  medium: "Equilibrado",
  high: "Inteligente"
};

interface EffortControlProps {
  value: EffortLevel;
  onChange: (value: EffortLevel) => void;
}

/**
 * Claude-style reasoning-effort segmented control. Rendered only when the
 * selected model's executor exposes an effort knob (see ModelOption.supportsEffort)
 * — today none of the usable CLIs do, so the form keeps it hidden by default.
 */
export function EffortControl({ value, onChange }: EffortControlProps): React.ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label="Esfuerzo de razonamiento"
      className="flex h-8 items-center gap-0.5 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
    >
      {EFFORT_LEVELS.map((level) => {
        const active = level === value;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={active}
            title={LABELS[level]}
            onClick={() => onChange(level)}
            className={[
              "rounded-[var(--r-sm)] px-2 text-[11px] font-medium transition-colors duration-150",
              active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]"
                : "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
            ].join(" ")}
          >
            {LABELS[level]}
          </button>
        );
      })}
    </div>
  );
}
