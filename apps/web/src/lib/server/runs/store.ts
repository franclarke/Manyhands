import { globalSingleton, resetGlobalSingleton } from "../global-singleton";
import { JsonRunRecordStore, resolveRunsDirectory, type RunRepository } from "./repository";

// On globalThis: the repository carries the per-run write-chain lock that
// serializes claims (INV-4); a per-bundle instance would not lock across routes.
export function getRunRepository(): RunRepository {
  return globalSingleton(
    "run-repository",
    () => new JsonRunRecordStore({ directory: resolveRunsDirectory() })
  );
}

export function resetRunRepositoryForTests(): void {
  resetGlobalSingleton("run-repository");
}
