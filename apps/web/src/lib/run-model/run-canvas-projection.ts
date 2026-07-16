import type { MinimalRunGraph, MinimalWorkspaceView } from "./minimal-workspace-view";
import { displayWaveOrdinal } from "./scheduling-wave-ordinal";
import type { RunModel, RunSchedulingWaveSelectedPayload } from "./types";

export type RunCanvasMode = "tasks" | "scheduling" | "integration" | "interfaces";

export interface SchedulingOverlaySummary {
  id: string;
  label: string;
  policy: RunSchedulingWaveSelectedPayload["policy"];
  running: number;
  serialized: Array<{ taskId: string; reason: string }>;
  risk: RunSchedulingWaveSelectedPayload["riskSummary"];
}

export interface RunCanvasProjection {
  mode: RunCanvasMode;
  graph: MinimalRunGraph;
  overlayNodeIds: string[];
  dimOutsideOverlay: boolean;
  showHierarchyEdges: boolean;
  showDependencyEdges: boolean;
  showSeamEdges: boolean;
  showConflictEdges: boolean;
  wave: SchedulingOverlaySummary | null;
}

/**
 * Projects runtime lenses over one canonical Task DAG. It never inserts,
 * removes or reparents graph nodes; a wave remains scheduling metadata.
 */
export function selectRunCanvasProjection(
  model: RunModel,
  view: MinimalWorkspaceView,
  mode: RunCanvasMode
): RunCanvasProjection {
  const orderedWaves = [...model.schedulingWaves.values()];
  const latestWave = orderedWaves.at(-1) ?? null;

  const wave = latestWave === null ? null : {
    id: latestWave.waveId,
    label: `W${displayWaveOrdinal(latestWave, orderedWaves.length - 1)}`,
    policy: latestWave.policy,
    running: latestWave.selectedTaskIds.filter((id) => view.graph.wavefront.includes(id)).length,
    serialized: latestWave.blockedReasons.map((item) => ({
      taskId: item.taskId,
      reason: item.reason
    })),
    risk: latestWave.riskSummary
  };

  const overlayNodeIds = mode === "scheduling"
    ? latestWave?.selectedTaskIds ?? []
    : mode === "integration"
      ? view.details.nodes.filter((node) => node.role !== "leaf").map((node) => node.id)
      : [];

  return {
    mode,
    graph: view.graph,
    overlayNodeIds: [...overlayNodeIds],
    dimOutsideOverlay: mode === "scheduling" && overlayNodeIds.length > 0,
    showHierarchyEdges: true,
    showDependencyEdges: mode === "tasks" || mode === "scheduling",
    showSeamEdges: mode === "interfaces",
    showConflictEdges: mode === "integration",
    wave
  };
}
