"use client";

import type { RunStatusKey } from "@/lib/api-types";
import type { RunGraphViewModel } from "@/lib/graph-view-model";
import { runProgress, runPhaseStepIndex, RUN_PHASE_STEPS, type RunFailurePhase } from "@/lib/run-phase";

interface RunPhaseBarProps {
  status: RunStatusKey;
  graph: RunGraphViewModel;
  /** When `status` is "failed", which phase broke — marks the real step. */
  failedPhase?: RunFailurePhase;
}

const DISPLAY_STEPS = RUN_PHASE_STEPS;

export function RunPhaseBar({ status, graph, failedPhase }: RunPhaseBarProps): React.ReactElement {
  const activeIndex = runPhaseStepIndex(status, failedPhase);
  const failed = status === "failed";
  const progress = runProgress(graph);
  const showProgress = status === "running" || status === "completed" || status === "failed";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        border: "1px solid var(--rule)",
        background: "rgba(19,20,22,0.82)",
        borderRadius: "var(--r-lg)",
        padding: "10px 14px"
      }}
    >
      <div role="list" aria-label="Run phase" style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        {DISPLAY_STEPS.map((step, index) => (
          <PhaseStep
            key={step}
            label={step}
            state={stepState(index, activeIndex, failed)}
            showArrow={index < DISPLAY_STEPS.length - 1}
          />
        ))}
      </div>

      {showProgress ? (
        <>
          <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 5 }}>
            <div
              aria-hidden
              style={{
                height: 4,
                borderRadius: 2,
                background: "var(--rule)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${Math.round(progress.ratio * 100)}%`,
                  height: "100%",
                  background: failed ? "var(--status-failed-fg)" : "var(--status-integrated-fg)",
                  transition: "width 240ms ease"
                }}
              />
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Count value={progress.completed} total={progress.total} label="completed" />
            {progress.running > 0 ? <Count value={progress.running} label="running" tone="running" /> : null}
            {progress.review > 0 ? <Count value={progress.review} label="review" tone="review" /> : null}
            {progress.failed > 0 ? <Count value={progress.failed} label="failed" tone="failed" /> : null}
          </div>
        </>
      ) : (
        <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
          {progress.total} {progress.total === 1 ? "node" : "nodes"} in the task graph
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
  label,
  state,
  showArrow
}: {
  label: string;
  state: StepState;
  showArrow: boolean;
}): React.ReactElement {
  const color =
    state === "active"
      ? "var(--copper-hi)"
      : state === "done"
        ? "var(--status-integrated-fg)"
        : state === "failed"
          ? "var(--status-failed-fg)"
          : "var(--text-2)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }} role="listitem">
      <span
        className={state === "active" ? "coral-pulse" : undefined}
        style={{
          fontSize: 12,
          color,
          fontWeight: state === "active" ? 700 : 500,
          padding: "5px 9px",
          borderRadius: 999,
          border: `1px solid ${state === "upcoming" ? "transparent" : "var(--rule)"}`,
          background: state === "active" ? "rgba(180,113,72,0.10)" : "transparent",
          whiteSpace: "nowrap"
        }}
      >
        {label}
      </span>
      {showArrow ? (
        <span aria-hidden style={{ color: "var(--text-4)", fontSize: 12 }}>
          &gt;
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
  tone?: "running" | "review" | "failed";
}): React.ReactElement {
  const color =
    tone === "running"
      ? "var(--status-running-fg)"
      : tone === "review"
        ? "var(--status-review-fg)"
        : tone === "failed"
          ? "var(--status-failed-fg)"
          : "var(--text)";
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
      <span className="mh-mono" style={{ fontSize: 13, color }}>
        {value}
        {total !== undefined ? <span style={{ color: "var(--text-2)" }}>/{total}</span> : null}
      </span>
      <span className="mh-coord">{label}</span>
    </span>
  );
}
