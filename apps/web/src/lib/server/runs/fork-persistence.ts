import { getWorkspaceRepository, withWorkspaceReferenceLock } from "../workspaces";
import type { WorkspaceRepository } from "../workspaces/repository";
import { RunNotFoundError, RunValidationError } from "./errors";
import type { RunRepository } from "./repository";
import type { RunRecord } from "./schema";
import { getRunRepository } from "./store";

export interface ForkPersistenceInput {
  sourceWorkspaceId: string;
  forkedRun: RunRecord;
  /** Clone into forkedRun.runId. Set together with cleanupCheckpoint. */
  cloneCheckpoint?: () => Promise<void>;
  /** Removes only checkpoint state owned by forkedRun.runId. */
  cleanupCheckpoint?: () => Promise<void>;
  /**
   * Final fenced-source check. It runs after the child save but inside the
   * compensable publication block, so losing source authority removes both
   * the just-saved child and its cloned checkpoint before returning.
   */
  validateAfterSave?: () => Promise<void>;
  runRepository?: RunRepository;
  workspaceRepository?: WorkspaceRepository;
}

/**
 * Publish a fork without exposing a RunRecord whose checkpoint clone failed.
 *
 * The checkpoint is staged before the RunRecord while the workspace-reference
 * lock is held. Any failure compensates only the freshly generated run id and
 * its checkpoint thread. The preflight existence check makes that ownership
 * explicit instead of trusting UUID collision probability during rollback.
 */
export async function persistForkAtomically(input: ForkPersistenceInput): Promise<RunRecord> {
  const hasClone = input.cloneCheckpoint !== undefined;
  const hasCleanup = input.cleanupCheckpoint !== undefined;
  if (hasClone !== hasCleanup) {
    throw new RunValidationError("Fork checkpoint clone and cleanup callbacks must be configured together.");
  }

  const runRepository = input.runRepository ?? getRunRepository();
  const workspaceRepository = input.workspaceRepository ?? getWorkspaceRepository();

  return withWorkspaceReferenceLock(async () => {
    const canonicalWorkspace = await workspaceRepository.get(input.sourceWorkspaceId);
    const forkedRun: RunRecord = { ...input.forkedRun, workspaceId: canonicalWorkspace.id };

    try {
      await runRepository.get(forkedRun.runId);
      throw new RunValidationError(
        `Cannot publish fork ${forkedRun.runId}: that run id already exists, so it is not owned by this operation.`
      );
    } catch (error) {
      if (!(error instanceof RunNotFoundError)) throw error;
    }

    let checkpointAttempted = false;
    let runSaveAttempted = false;
    try {
      if (input.cloneCheckpoint !== undefined) {
        checkpointAttempted = true;
        await input.cloneCheckpoint();
      }
      runSaveAttempted = true;
      const saved = await runRepository.save(forkedRun);
      await input.validateAfterSave?.();
      return saved;
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      if (runSaveAttempted) {
        try {
          await runRepository.delete(forkedRun.runId);
        } catch (rollbackError) {
          if (!(rollbackError instanceof RunNotFoundError)) rollbackErrors.push(rollbackError);
        }
      }
      if (checkpointAttempted && input.cleanupCheckpoint !== undefined) {
        try {
          await input.cleanupCheckpoint();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Fork ${forkedRun.runId} failed and its owned rollback was incomplete.`
        );
      }
      throw error;
    }
  });
}
