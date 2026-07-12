import { ExecutionConfigSchema, type ExecutionConfig } from "@manyhands/execution-core";
import { updateRunForOperation } from "./run-operation-lease";
import type { ExecutionConfigInput, RunOperationLease, RunRecord } from "./schema";

/** Single normalization boundary for new and legacy run execution config. */
export function effectiveExecutionConfig(config: ExecutionConfigInput | undefined): ExecutionConfig {
  return ExecutionConfigSchema.parse(config ?? {});
}

/** Persist every default before scheduling or dispatch can observe the run. */
export function persistEffectiveExecutionConfig(
  runId: string,
  lease?: RunOperationLease
): Promise<RunRecord> {
  return updateRunForOperation(runId, lease, (current) => ({
    ...current,
    executionConfig: effectiveExecutionConfig(current.executionConfig)
  }));
}
