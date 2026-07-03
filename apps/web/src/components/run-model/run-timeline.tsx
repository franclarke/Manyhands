"use client";

/**
 * Run phase rail — a horizontal, always-visible projection of the run maturing
 * through its lifecycle (Intención → Plan → Ejecución → Integración → Revisión).
 * Presentational only: it paints a `RunPhase[]` built by `selectRunTimeline`.
 * Ember touches the LIVE phase dot only (one dot per screen); done = sage,
 * pending = faint, failed = rust. Honors prefers-reduced-motion via `coral-pulse`.
 */
import { Fragment } from "react";
import type { RunPhase, RunPhaseState } from "@/lib/run-model/run-phases";

export function RunTimeline({
  phases,
  trailing
}: {
  phases: RunPhase[];
  /** Right-aligned chrome sharing the rail row (e.g. the dock toggles). */
  trailing?: React.ReactNode | undefined;
}): React.ReactElement {
  return (
    <nav
      aria-label="Fases del run"
      className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5"
    >
      {/* The phase rail yields width to the trailing chrome: it scrolls inside
          its own min-w-0 box instead of pushing the toggles past the viewport. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {phases.map((phase, index) => (
        <Fragment key={phase.key}>
          <div
            className={[
              "flex shrink-0 items-center gap-2",
              // The active phase gets the same faint neutral lift as the active tab —
              // one "you are here" language across the cockpit chrome.
              phase.state === "active"
                ? "-mx-0.5 rounded-[var(--r-md)] bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)] px-2 py-1"
                : ""
            ].join(" ")}
          >
            <PhaseDot state={phase.state} />
            {/* Narrow viewports keep every dot but only the load-bearing labels
                (active/failed) — otherwise the rail + dock toggles overflow. */}
            <div
              className={[
                "flex-col leading-tight",
                phase.state === "active" || phase.state === "failed" ? "flex" : "hidden sm:flex"
              ].join(" ")}
            >
              <span className={LABEL_CLASS[phase.state]}>{phase.label}</span>
              {phase.detail !== undefined ? (
                <span className="mh-mono hidden text-eyebrow tabular-nums text-[var(--color-text-subtle)] sm:inline">
                  {phase.detail}
                </span>
              ) : null}
            </div>
          </div>
          {index < phases.length - 1 ? <Connector lit={phase.state === "done"} /> : null}
        </Fragment>
      ))}
      </div>
      {trailing !== undefined ? <div className="ml-auto flex shrink-0 items-center gap-1 pl-3">{trailing}</div> : null}
    </nav>
  );
}

const LABEL_CLASS: Record<RunPhaseState, string> = {
  done: "text-meta text-[var(--color-text-muted)]",
  active: "text-meta font-medium text-[var(--color-text)]",
  pending: "text-meta text-[var(--color-text-faint)]",
  failed: "text-meta font-medium text-[var(--status-failed-fg)]"
};

function PhaseDot({ state }: { state: RunPhaseState }): React.ReactElement {
  if (state === "done") {
    return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--status-completed-fg)]" />;
  }
  if (state === "active") {
    return <span aria-hidden className="coral-pulse h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-accent)]" />;
  }
  if (state === "failed") {
    return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--status-failed-fg)]" />;
  }
  return (
    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-text-faint)] bg-transparent" />
  );
}

function Connector({ lit }: { lit: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden
      className="h-px min-w-[14px] max-w-[44px] flex-1"
      style={{ background: lit ? "var(--status-completed-border)" : "var(--color-border)" }}
    />
  );
}
