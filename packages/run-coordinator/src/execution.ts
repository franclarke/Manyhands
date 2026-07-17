import type { RunCoordinator } from "./coordinator.js";
import type { RunProjection } from "./reducer.js";

export interface ExecutionReadinessObservation {
  readyNodeIds: string[];
  pendingDecisionIds: string[];
}

export interface ExecutionDispatch {
  runId: string;
  waveId: string;
  nodeId: string;
}

export interface RunExecutionCoordinatorOptions {
  coordinator: RunCoordinator;
  observeReadiness(runId: string, state: RunProjection): Promise<ExecutionReadinessObservation>;
  selectWave(input: { runId: string; readyNodeIds: string[]; maxParallel: number; state: RunProjection }): string[];
  waveId(input: { runId: string; state: RunProjection }): string;
  dispatch(input: ExecutionDispatch): Promise<void>;
}

/**
 * Command-driven execution cursor. Readiness and the selected wave become
 * durable facts before dispatch; decisions never mutate node state directly.
 */
export class RunExecutionCoordinator {
  private readonly options: RunExecutionCoordinatorOptions;

  constructor(options: RunExecutionCoordinatorOptions) {
    this.options = options;
  }

  async advance(runId: string, effectiveConfig: { maxParallel: number }): Promise<RunProjection> {
    if (!Number.isInteger(effectiveConfig.maxParallel) || effectiveConfig.maxParallel < 1) {
      throw new Error("Execution requires a persisted positive maxParallel.");
    }

    let state = await this.current(runId);
    const observation = await this.options.observeReadiness(runId, state);
    state = await this.options.coordinator.execute(runId, {
      type: "observe_readiness",
      readyNodeIds: unique(observation.readyNodeIds),
      pendingDecisionIds: unique(observation.pendingDecisionIds)
    });
    if (state.lifecycle !== "running" || state.readiness.readyNodeIds.length === 0) return state;

    const selected = unique(this.options.selectWave({
      runId,
      readyNodeIds: [...state.readiness.readyNodeIds],
      maxParallel: effectiveConfig.maxParallel,
      state
    }));
    if (selected.length === 0) throw new Error("Wave selector returned no nodes despite observed readiness.");
    if (selected.length > effectiveConfig.maxParallel) throw new Error("Wave selector exceeded maxParallel.");
    const ready = new Set(state.readiness.readyNodeIds);
    if (selected.some((nodeId) => !ready.has(nodeId))) throw new Error("Wave selector returned a node outside observed readiness.");

    const waveId = this.options.waveId({ runId, state });
    state = await this.options.coordinator.execute(runId, {
      type: "select_wave",
      waveId,
      nodeIds: selected,
      maxParallel: effectiveConfig.maxParallel
    });

    // Persistence above is an awaited safety boundary. No dispatch can begin
    // if the event journal rejects or loses authority.
    await Promise.all(selected.map((nodeId) => this.options.dispatch({ runId, waveId, nodeId })));
    return state;
  }

  async resolveDecisionAndAdvance(
    runId: string,
    resolution: { decisionId: string; optionId?: string; answer?: string },
    effectiveConfig: { maxParallel: number }
  ): Promise<RunProjection> {
    await this.options.coordinator.execute(runId, { type: "resolve_decision", ...resolution });
    return this.advance(runId, effectiveConfig);
  }

  private async current(runId: string): Promise<RunProjection> {
    return this.options.coordinator.load(runId);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
