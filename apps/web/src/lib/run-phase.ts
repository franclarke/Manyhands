import type { RunStatusKey } from "@/lib/api-types";
import type { RunGraphViewModel } from "@/lib/graph-view-model";

/**
 * The Run Workspace is a single phase-aware surface (one route, `/runs/[id]`).
 * The phase is *derived* from the run status (+ graph), never a separate route.
 * The chrome (action bar, side panel, overlays, summary) reconfigures per phase.
 */
export type RunPhase = "planning" | "executing" | "integrating" | "done";

/** Which pipeline a failure occurred in, used to mark the right phase-bar step. */
export type RunFailurePhase = "planning" | "execution";

/** Linear steps shown in the run phase bar. */
export const RUN_PHASE_STEPS = [
  "Plan generated",
  "Review plan",
  "Execute agents",
  "Review outputs",
  "Integrate"
] as const;

/**
 * Index of the active (or failed) step within {@link RUN_PHASE_STEPS}.
 *
 * For a failed run, `failedPhase` disambiguates WHERE it broke so the bar marks
 * the real step: an execution failure (e.g. repo provisioning) stops at
 * "Execute agents", a planning failure at "Plan generated". Without that signal
 * we fall back to "Review outputs" to preserve the previous behavior.
 */
export function runPhaseStepIndex(status: RunStatusKey, failedPhase?: RunFailurePhase): number {
  switch (status) {
    case "created":
    case "generating":
      return 0;
    case "needs_review":
      return 1;
    case "approved":
    case "running":
    case "paused":
    case "interrupted":
      return 2;
    case "completed":
      return 4;
    case "failed":
      return failedPhase === "execution" ? 2 : failedPhase === "planning" ? 0 : 3;
    default:
      return 0;
  }
}

export const RUN_PHASES: readonly RunPhase[] = ["planning", "executing", "integrating", "done"];

export const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  planning: "Planning",
  executing: "Executing",
  integrating: "Integrating",
  done: "Done"
};

/** Base phase from run status alone (used for chrome + as fallback). */
export function runPhase(status: RunStatusKey): RunPhase {
  switch (status) {
    case "created":
    case "generating":
    case "needs_review":
    case "approved":
      return "planning";
    case "running":
    case "paused":
    case "interrupted":
      return "executing";
    case "completed":
    case "failed":
      return "done";
    default:
      return "planning";
  }
}

/**
 * Refined phase: while executing, surface "integrating" when an integrator node
 * is actively running. Integration is a sub-phase of execution, derived from the
 * graph rather than a distinct run status.
 */
export function derivePhase(status: RunStatusKey, graph: RunGraphViewModel | null): RunPhase {
  const base = runPhase(status);
  if (base !== "executing" || graph === null) {
    return base;
  }
  const integratorActive = graph.nodes.some(
    (node) => node.integrator === true && (node.status === "running" || node.status === "generating")
  );
  return integratorActive ? "integrating" : "executing";
}

export interface RunProgress {
  total: number;
  completed: number;
  running: number;
  failed: number;
  review: number;
  blocked: number;
  pending: number;
  /** 0–1 completion ratio over all tasks. */
  ratio: number;
}

/** Aggregate run progress from the graph status counts (UiStatus groupings). */
export function runProgress(graph: RunGraphViewModel): RunProgress {
  const s = graph.status;
  const completed = s.done + s.approved + s.integrated;
  const running = s.running + s.generating;
  const failed = s.failed;
  const review = s.gated + s.needs_review;
  const blocked = s.blocked;
  const pending = s.planned + s.ready;
  const total = graph.summary.taskCount;
  return {
    total,
    completed,
    running,
    failed,
    review,
    blocked,
    pending,
    ratio: total > 0 ? completed / total : 0
  };
}
