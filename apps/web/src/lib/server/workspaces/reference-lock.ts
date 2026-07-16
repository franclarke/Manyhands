import { withWorkspaceFileLock, type WorkspaceFileLockOptions } from "./file-lock";
import { resolveWorkspacesFilePath } from "./repository";

/**
 * Serializes changes to the workspace↔run reference boundary across processes.
 *
 * A run create/fork must publish its RunRecord while holding the same lock that
 * a workspace delete uses to prove there are no references. The lock has its
 * own path so repository CRUD can safely acquire the workspace document lock
 * inside this critical section without reentrancy.
 */
export function withWorkspaceReferenceLock<T>(
  operation: () => Promise<T>,
  options: WorkspaceFileLockOptions = {}
): Promise<T> {
  return withWorkspaceFileLock(`${resolveWorkspacesFilePath()}.references`, operation, options);
}
