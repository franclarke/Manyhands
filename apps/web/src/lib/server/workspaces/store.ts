import { JsonWorkspaceRepository, resolveWorkspacesFilePath, type WorkspaceRepository } from "./repository";

let singleton: WorkspaceRepository | null = null;

export function getWorkspaceRepository(): WorkspaceRepository {
  if (singleton === null) {
    singleton = new JsonWorkspaceRepository({ filePath: resolveWorkspacesFilePath() });
  }
  return singleton;
}

export function resetWorkspaceRepositoryForTests(): void {
  singleton = null;
}
