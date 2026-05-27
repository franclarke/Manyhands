import { JsonRunRecordStore, resolveRunsDirectory, type RunRepository } from "./repository";

let singleton: RunRepository | null = null;

export function getRunRepository(): RunRepository {
  if (singleton === null) {
    singleton = new JsonRunRecordStore({ directory: resolveRunsDirectory() });
  }
  return singleton;
}

export function resetRunRepositoryForTests(): void {
  singleton = null;
}
