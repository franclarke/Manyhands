"use client";

import { HelpCircle } from "lucide-react";

export type EffortLevel = "low" | "medium" | "high";

export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high"];

const LABELS: Record<EffortLevel, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto"
};

const HINTS: Record<EffortLevel, string> = {
  low: "Rápido: menor profundidad, menor costo y tiempo.",
  medium: "Equilibrado: balance óptimo de costo y razonamiento.",
  high: "Inteligente: razonamiento profundo para tareas complejas."
};

interface EffortControlProps {
  value: EffortLevel;
  onChange: (value: EffortLevel) => void;
}

export function EffortControl({ value, onChange }: EffortControlProps): React.ReactElement {
  const currentIndex = EFFORT_LEVELS.indexOf(value);

  return (
    <div className="flex flex-col gap-1 min-w-[160px] select-none">
      {/* Title block with Tooltip */}
      <div className="flex items-center gap-1.5 h-4">
        <span className="mh-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-subtle)] font-medium">
          Esfuerzo: <span className="text-[var(--color-text)] font-semibold">{LABELS[value]}</span>
        </span>
        <div className="relative group cursor-pointer">
          <HelpCircle className="h-3.5 w-3.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors" />
          {/* Tooltip on hover */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-48 rounded-[var(--r-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2.5 text-[11px] text-[var(--color-text-muted)] shadow-[var(--shadow-lift)] leading-relaxed pointer-events-none">
            {HINTS[value]}
          </div>
        </div>
      </div>

      {/* Slider container */}
      <div
        role="slider"
        aria-label="Esfuerzo de razonamiento"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={currentIndex}
        aria-valuetext={LABELS[value]}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            const newIndex = Math.max(0, currentIndex - 1);
            onChange(EFFORT_LEVELS[newIndex]!);
          } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            const newIndex = Math.min(EFFORT_LEVELS.length - 1, currentIndex + 1);
            onChange(EFFORT_LEVELS[newIndex]!);
          }
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const percentage = clickX / rect.width;
          let newIndex = 1;
          if (percentage < 0.33) newIndex = 0;
          else if (percentage > 0.66) newIndex = 2;
          onChange(EFFORT_LEVELS[newIndex]!);
        }}
        className="relative flex items-center h-4 py-1.5 cursor-pointer focus:outline-none"
      >
        {/* Track */}
        <div className="w-full h-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)] border border-[var(--color-border-soft)] relative">
          {/* Active range indicator */}
          <div
            className="absolute top-0 left-0 h-full bg-[var(--color-accent)] opacity-40 rounded-full transition-all duration-200"
            style={{ width: `${(currentIndex / 2) * 100}%` }}
          />

          {/* Notches */}
          {EFFORT_LEVELS.map((_, i) => (
            <div
              key={i}
              className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full -translate-x-1/2 transition-colors duration-200 ${
                i <= currentIndex 
                  ? "bg-[var(--color-accent)]" 
                  : "bg-[color-mix(in_srgb,var(--color-text)_25%,transparent)]"
              }`}
              style={{ left: `${(i / 2) * 100}%` }}
            />
          ))}
        </div>

        {/* Sliding Thumb */}
        <div
          className="absolute w-3 h-5 rounded-[4px] bg-[var(--color-text-muted)] hover:bg-[var(--color-text)] border border-[var(--color-border-strong)] shadow-[var(--shadow-lift)] -translate-x-1/2 transition-all duration-200 ease-out pointer-events-none"
          style={{ left: `${(currentIndex / 2) * 100}%` }}
        />
      </div>

      {/* Sub-label showing faster / smarter under the track */}
      <div className="flex justify-between text-[9px] text-[var(--color-text-subtle)] px-0.5 mt-0.5 leading-none">
        <span>Más rápido</span>
        <span>Más inteligente</span>
      </div>
    </div>
  );
}
