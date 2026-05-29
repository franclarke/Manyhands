"use client";

import type { RunStatusKey } from "@/lib/api-types";
import type { RunGraphViewModel } from "@/lib/graph-view-model";
import { derivePhase, runProgress, RUN_PHASES, RUN_PHASE_LABEL, type RunPhase } from "@/lib/run-phase";

interface RunPhaseBarProps {
  status: RunStatusKey;
  graph: RunGraphViewModel;
}

/**
 * Phase-aware header band for the Run Workspace. Shows the run's lifecycle as a
 * stepper (Planning → Executing → Integrating → Done) and, once work is moving,
 * an aggregate progress read-out — so the user understands "where" the run is
 * and "how far" without reading logs.
 */
export function RunPhaseBar({ status, graph }: RunPhaseBarProps): React.ReactElement {
  const phase = derivePhase(status, graph);
  const failed = status === "failed";
  const progress = runProgress(graph);
  const currentIndex = RUN_PHASES.indexOf(phase);
  const showProgress = phase === "executing" || phase === "integrating" || phase === "done";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-subtle)",
        borderRadius: "var(--r-lg)",
        padding: "9px 14px"
      }}
    >
      <div role="list" aria-label="Run phase" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {RUN_PHASES.map((p, index) => (
          <PhaseStep
            key={p}
            phase={p}
            state={stepState(index, currentIndex, failed)}
            showArrow={index < RUN_PHASES.length - 1}
          />
        ))}
      </div>

      {showProgress ? (
        <>
          <div style={{ flex: 1, minWidth: 120, display: "flex", flexDirection: "column", gap: 5 }}>
            <div
              aria-hidden
              style={{
                height: 3,
                borderRadius: 2,
                background: "var(--color-border)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${Math.round(progress.ratio * 100)}%`,
                  height: "100%",
                  background: failed ? "var(--status-failed-fg)" : "var(--status-completed-fg)",
                  transition: "width 240ms ease"
                }}
              />
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <Count value={progress.completed} total={progress.total} label="done" />
            {progress.running > 0 ? <Count value={progress.running} label="running" /> : null}
            {progress.review > 0 ? <Count value={progress.review} label="review" /> : null}
            {progress.failed > 0 ? <Count value={progress.failed} label="failed" tone="failed" /> : null}
          </div>
        </>
      ) : (
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--color-text-subtle)" }}>
          {progress.total} {progress.total === 1 ? "task" : "tasks"} planned
        </span>
      )}
    </div>
  );
}

type StepState = "done" | "active" | "failed" | "upcoming";

function stepState(index: number, currentIndex: number, failed: boolean): StepState {
  if (index < currentIndex) return "done";
  if (index === currentIndex) return failed ? "failed" : "active";
  return "upcoming";
}

function PhaseStep({
  phase,
  state,
  showArrow
}: {
  phase: RunPhase;
  state: StepState;
  showArrow: boolean;
}): React.ReactElement {
  const color =
    state === "active"
      ? "var(--color-accent)"
      : state === "done"
        ? "var(--status-completed-fg)"
        : state === "failed"
          ? "var(--status-failed-fg)"
          : "var(--color-text-subtle)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} role="listitem">
      <span
        className={state === "active" ? "mh-mono coral-pulse" : "mh-mono"}
        style={{
          fontSize: 11,
          letterSpacing: 0.04,
          color,
          fontWeight: state === "active" ? 600 : 400,
          padding: "2px 8px",
          borderRadius: 999,
          border: `1px solid ${state === "upcoming" ? "transparent" : "var(--color-border)"}`,
          background: state === "active" ? "var(--status-planning-bg)" : "transparent"
        }}
      >
        {RUN_PHASE_LABEL[phase]}
      </span>
      {showArrow ? (
        <span aria-hidden style={{ color: "var(--color-text-faint)", fontSize: 11 }}>
          ›
        </span>
      ) : null}
    </span>
  );
}

function Count({
  value,
  total,
  label,
  tone
}: {
  value: number;
  total?: number;
  label: string;
  tone?: "failed";
}): React.ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
      <span
        className="mh-mono"
        style={{ fontSize: 13, color: tone === "failed" ? "var(--status-failed-fg)" : "var(--color-text)" }}
      >
        {value}
        {total !== undefined ? <span style={{ color: "var(--color-text-subtle)" }}>/{total}</span> : null}
      </span>
      <span className="mh-coord">{label}</span>
    </span>
  );
}
