/** Productive canonical driver. Lifecycle facts remain owned by RunCoordinator. */
export { CanonicalExecutionDriver } from "./canonical-execution-driver.js";
export { assertNoConcurrentResourceConflict } from "./concurrent-resource-invariant.js";
export type {
  CanonicalExecutionDriverOptions,
  CanonicalExecutionRunInput,
  CanonicalExecutionTarget,
  CanonicalExecutorProfile,
  CanonicalNodeExecutionInput,
  CanonicalNodeExecutionOutcome
} from "./canonical-execution-driver.js";
/** Historical V2 reader retained only for old-journal compatibility tests. */
export { V2ExecutionDriver, leafFailureObservation, orderArtifactRequirementsForMaterialization, retryBudgetFor } from "./v2/execution-driver.js";
export type {
  V2ExecutionDriverOptions,
  V2ExecutionFreshnessInputs,
  V2ExecutionRunInput,
  V2ExecutionTarget,
  V2ExecutorProfile,
  V2NodeExecutionInput,
  V2NodeExecutionOutcome,
  V2RepairObservation
} from "./v2/execution-driver.js";
