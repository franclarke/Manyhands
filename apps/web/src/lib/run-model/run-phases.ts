/**
 * Run phase timeline — the run's position in its lifecycle as a five-step rail:
 * Intención → Plan → Ejecución → Integración → Revisión. These mirror the
 * canonical agent-first phases (framing / proposal / supervision / reconciliation
 * / disposition; foundation folds into the start of execution).
 *
 * PURE and node-testable: derives from the reduced run signals only — never the
 * raw event log (that stays with `buildTimelineView`, the audit trail) and never
 * React. It DERIVES, it does not persist: the rail recomputes from status + stage
 * + node counts every render.
 */
import type { RunControlStatus, RunModel } from "./types";
import type { ProductStage } from "./minimal-workspace-view";

export type RunPhaseKey = "framing" | "proposal" | "execution" | "integration" | "disposition";
export type RunPhaseState = "done" | "active" | "pending" | "failed";

export interface RunPhase {
  key: RunPhaseKey;
  label: string;
  state: RunPhaseState;
  /** Optional sub-label, e.g. the verified-leaf count under Ejecución. */
  detail?: string;
}

export interface RunPhaseInput {
  stage: ProductStage;
  status: RunControlStatus;
  /** Executable leaves in the graph. */
  leafTotal: number;
  /** Leaves whose work is integrated (verified + merged into the subtree). */
  leafDone: number;
  /** The root/integrator node finished integrating bottom-up. */
  rootIntegrated: boolean;
}

const PHASE_LABELS: ReadonlyArray<{ key: RunPhaseKey; label: string }> = [
  { key: "framing", label: "Intención" },
  { key: "proposal", label: "Plan" },
  { key: "execution", label: "Ejecución" },
  { key: "integration", label: "Integración" },
  { key: "disposition", label: "Revisión" }
];

/** Which phase index is the centre of gravity right now (0–4). */
function activePhaseIndex(input: RunPhaseInput): number {
  switch (input.stage) {
    case "intent":
      return 0;
    case "proposal":
      return 1;
    case "running":
      // Execution finished and the tree is composing bottom-up → Integración.
      return input.leafTotal > 0 && input.leafDone >= input.leafTotal && !input.rootIntegrated ? 3 : 2;
    case "review":
      return 4;
    default:
      return 0;
  }
}

/** `RunPhaseInput → ordered phase rail` with per-phase state. */
export function deriveRunTimeline(input: RunPhaseInput): RunPhase[] {
  const accepted = input.status === "completed_with_accepted";
  const failed = input.status === "failed";
  const active = activePhaseIndex(input);

  return PHASE_LABELS.map(({ key, label }, index) => {
    let state: RunPhaseState;
    if (accepted) {
      state = "done";
    } else if (failed) {
      state = index < active ? "done" : index === active ? "failed" : "pending";
    } else {
      state = index < active ? "done" : index === active ? "active" : "pending";
    }
    // The verified-leaf count is only meaningful while execution is live; on a
    // done phase it would read as "incomplete" on a finished run.
    const detail =
      key === "execution" && state === "active" && input.leafTotal > 0
        ? `${input.leafDone}/${input.leafTotal} verificadas`
        : undefined;
    return detail !== undefined ? { key, label, state, detail } : { key, label, state };
  });
}

export type GraphEmptyKind = "planning" | "failed" | "interrupted";

/**
 * When the graph has no nodes yet, what is the canvas REALLY showing? A failed or
 * interrupted run must not paint the optimistic "building the plan" state.
 */
export function graphEmptyStateKind(status: RunControlStatus): GraphEmptyKind {
  if (status === "failed") return "failed";
  if (status === "interrupted" || status === "cancelling") return "interrupted";
  return "planning";
}

/** Build the rail from a reduced `RunModel` (+ the product stage selector output). */
export function selectRunTimeline(model: RunModel, stage: ProductStage): RunPhase[] {
  const nodes = [...model.nodes.values()];
  const leaves = nodes.filter((node) => node.role === "leaf");
  const leafDone = leaves.filter((node) => node.execution.kind === "integrated").length;
  const root = nodes.find((node) => node.role === "root");
  const rootIntegrated = root?.execution.kind === "integrated";
  return deriveRunTimeline({
    stage,
    status: model.run.control.status,
    leafTotal: leaves.length,
    leafDone,
    rootIntegrated: rootIntegrated === true
  });
}
