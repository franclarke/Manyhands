/** Canonical V2 execution driver. Lifecycle and facts belong to RunCoordinator. */
export { V2ExecutionDriver, leafFailureObservation, orderArtifactRequirementsForMaterialization } from "./v2/execution-driver.js";
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
