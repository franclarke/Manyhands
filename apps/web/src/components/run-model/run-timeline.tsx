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

export function RunTimeline({ phases }: { phases: RunPhase[] }): React.ReactElement {
  return (
    <nav
      aria-label="Fases del run"
      className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5"
    >
      {phases.map((phase, index) => (
        <Fragment key={phase.key}>
          <div
            className={[
              "flex items-center gap-2",
              // The active phase gets the same faint neutral lift as the active tab —
              // one "you are here" language across the cockpit chrome.
              phase.state === "active"
                ? "-mx-0.5 rounded-[var(--r-md)] bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)] px-2 py-1"
                : ""
            ].join(" ")}
          >
            <PhaseDot state={phase.state} />
            <div className="flex flex-col leading-tight">
              <span className={LABEL_CLASS[phase.state]}>{phase.label}</span>
              {phase.detail !== undefined ? (
                <span className="mh-mono text-eyebrow tabular-nums text-[var(--color-text-subtle)]">{phase.detail}</span>
              ) : null}
            </div>
          </div>
          {index < phases.length - 1 ? <Connector lit={phase.state === "done"} /> : null}
        </Fragment>
      ))}
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
