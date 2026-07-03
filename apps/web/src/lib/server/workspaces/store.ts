import { globalSingleton, resetGlobalSingleton } from "../global-singleton";
import { JsonWorkspaceRepository, resolveWorkspacesFilePath, type WorkspaceRepository } from "./repository";

// On globalThis: shared across Next route bundles (see global-singleton.ts).
export function getWorkspaceRepository(): WorkspaceRepository {
  return globalSingleton(
    "workspace-repository",
    () => new JsonWorkspaceRepository({ filePath: resolveWorkspacesFilePath() })
  );
}

export function resetWorkspaceRepositoryForTests(): void {
  resetGlobalSingleton("workspace-repository");
}
