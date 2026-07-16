"use client";

import { useId } from "react";
import { HelpCircle } from "lucide-react";
import { EFFORT_LEVELS as CANONICAL_EFFORT_LEVELS, type EffortLevel } from "@manyhands/shared";

export type { EffortLevel };

const LABELS: Record<EffortLevel, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Máximo"
};

const HINTS: Record<EffortLevel, string> = {
  low: "Rápido: menor profundidad, menor costo y tiempo.",
  medium: "Equilibrado: balance óptimo de costo y razonamiento.",
  high: "Inteligente: razonamiento profundo para tareas complejas.",
  xhigh: "Exhaustivo: razonamiento máximo para las tareas más difíciles."
};

interface EffortControlProps {
  value: EffortLevel;
  onChange: (value: EffortLevel) => void;
  /** Effort levels the selected model declares (from the registry). Defaults to the full canonical set. */
  levels?: readonly EffortLevel[];
}

export function EffortControl({ value, onChange, levels }: EffortControlProps): React.ReactElement {
  const hintId = useId();
  const effortLevels = levels !== undefined && levels.length > 0 ? levels : CANONICAL_EFFORT_LEVELS;
  const maxIndex = effortLevels.length - 1;
  const rawIndex = effortLevels.indexOf(value);
  const currentIndex = rawIndex >= 0 ? rawIndex : 0;

  return (
    <div className="flex flex-col gap-1 min-w-[160px] select-none">
      {/* Title block with Tooltip */}
      <div className="flex items-center gap-1.5 h-4">
        <span className="text-meta font-medium text-[var(--color-text-subtle)]">
          Esfuerzo: <span className="text-[var(--color-text)] font-semibold">{LABELS[value]}</span>
        </span>
        <div className="relative group">
          <button type="button" aria-label="Ayuda sobre el esfuerzo de razonamiento" aria-describedby={hintId} className="flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
            <HelpCircle aria-hidden className="h-3.5 w-3.5" />
          </button>
          <div id={hintId} role="tooltip" className="absolute bottom-full left-1/2 z-50 mb-2 hidden w-48 -translate-x-1/2 rounded-[var(--r-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 text-meta leading-relaxed text-[var(--color-text-muted)] pointer-events-none group-hover:block group-focus-within:block">
            {HINTS[value]}
          </div>
        </div>
      </div>

      {/* Slider container */}
      <div
        role="slider"
        aria-label="Esfuerzo de razonamiento"
        aria-valuemin={0}
        aria-valuemax={maxIndex}
        aria-valuenow={currentIndex}
        aria-valuetext={LABELS[value]}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            const newIndex = Math.max(0, currentIndex - 1);
            onChange(effortLevels[newIndex]!);
          } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            const newIndex = Math.min(maxIndex, currentIndex + 1);
            onChange(effortLevels[newIndex]!);
          }
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const percentage = Math.min(1, Math.max(0, clickX / rect.width));
          const newIndex = Math.round(percentage * maxIndex);
          onChange(effortLevels[newIndex]!);
        }}
        className="relative flex h-10 items-center py-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
      >
        {/* Track */}
        <div className="w-full h-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)] border border-[var(--color-border-soft)] relative">
          {/* Active range indicator */}
          <div
            className="absolute top-0 left-0 h-full bg-[var(--color-accent)] opacity-40 rounded-full transition-all duration-200"
            style={{ width: maxIndex > 0 ? `${(currentIndex / maxIndex) * 100}%` : "0%" }}
          />

          {/* Notches */}
          {effortLevels.map((level, i) => (
            <div
              key={level}
              className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full -translate-x-1/2 transition-colors duration-200 ${
                i <= currentIndex
                  ? "bg-[var(--color-accent)]"
                  : "bg-[color-mix(in_srgb,var(--color-text)_25%,transparent)]"
              }`}
              style={{ left: maxIndex > 0 ? `${(i / maxIndex) * 100}%` : "0%" }}
            />
          ))}
        </div>

        {/* Sliding Thumb */}
        <div
          className="absolute h-6 w-5 rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-text-muted)] mh-elev-1 -translate-x-1/2 pointer-events-none transition-all duration-200 ease-out"
          style={{ left: maxIndex > 0 ? `${(currentIndex / maxIndex) * 100}%` : "0%" }}
        />
      </div>

      {/* Sub-label showing faster / smarter under the track */}
      <div className="flex justify-between text-micro text-[var(--color-text-subtle)] px-0.5 mt-0.5 leading-none">
        <span>Más rápido</span>
        <span>Más inteligente</span>
      </div>
    </div>
  );
}
