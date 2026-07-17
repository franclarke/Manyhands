import {
  RunCoordinator,
  RunExecutionCoordinator,
  type ExecutionReadinessObservation,
  type RunProjection
} from "@manyhands/run-coordinator";
import { JsonlRunEventStore, type FencingAuthority } from "@manyhands/run-store";

export interface ExecutionCoordinatorHostV2Options {
  runId: string;
  authority: FencingAuthority;
  events: JsonlRunEventStore;
  observeReadiness(runId: string, state: RunProjection): Promise<ExecutionReadinessObservation>;
  selectWave(input: { runId: string; readyNodeIds: string[]; maxParallel: number; state: RunProjection }): string[];
  dispatch(input: { runId: string; waveId: string; nodeId: string }): Promise<void>;
  now?(): string;
}

/** Binds the framework-independent V2 cursor to the durable fenced event log. */
export async function createExecutionCoordinatorHostV2(
  options: ExecutionCoordinatorHostV2Options
): Promise<RunExecutionCoordinator> {
  await options.events.advanceFence(options.runId, options.authority);
  const coordinator = new RunCoordinator({
    events: options.events.bind(options.authority),
    delivery: {
      publish: async () => {
        throw new Error("Delivery is not available from the execution host.");
      }
    },
    clock: options.now ?? (() => new Date().toISOString()),
    eventId: (type, sequence) => `${options.runId}:${type}:${sequence}`
  });
  return new RunExecutionCoordinator({
    coordinator,
    observeReadiness: options.observeReadiness,
    selectWave: options.selectWave,
    waveId: ({ runId, state }) => `${runId}:wave:${state.selectedWaves.length + 1}`,
    dispatch: options.dispatch
  });
}
