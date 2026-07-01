import type { Actor } from "@/lib/run-model/types";
import { appendRunStatusChanged } from "./run-status-events";
import { publishRunEvent } from "./event-bus";
import { appendRunEventsRequired, type RunModelEventInput } from "./run-model-event-log";
import { runControlForRun } from "./run-model-projection";
import type { RunRecord } from "./schema";
import { getRunRepository } from "./store";

export class RunPersistenceConsistencyError extends Error {
  constructor(
    message: string,
    readonly details: {
      runId: string;
      previousStatus?: RunRecord["status"];
      attemptedStatus?: RunRecord["status"];
      rollback: "not_needed" | "succeeded" | "failed";
      cause: unknown;
      rollbackCause?: unknown;
    }
  ) {
    super(message);
    this.name = "RunPersistenceConsistencyError";
  }
}

export interface RequiredStatusEventOptions {
  at?: string;
  actor?: Actor;
}

export function requireCapturedRunRecord(run: RunRecord | undefined, runId: string): RunRecord {
  if (run === undefined) {
    throw new RunPersistenceConsistencyError(
      `Run ${runId} mutation did not capture its previous record; required status event was not appended.`,
      {
        runId,
        rollback: "not_needed",
        cause: new Error("missing_previous_run_record")
      }
    );
  }
  return run;
}

export async function saveRunWithRequiredStatusEvent(
  previous: RunRecord,
  next: RunRecord,
  options: RequiredStatusEventOptions = {}
): Promise<RunRecord> {
  let saved: RunRecord;
  try {
    saved = await getRunRepository().save(next);
  } catch (error) {
    throw new RunPersistenceConsistencyError(
      `Failed to save RunRecord for required status transition on run ${next.runId}; event was not appended.`,
      {
        runId: next.runId,
        previousStatus: previous.status,
        attemptedStatus: next.status,
        rollback: "not_needed",
        cause: error
      }
    );
  }

  return appendStatusEventOrRollback(previous, saved, options);
}

export async function appendStatusEventOrRollback(
  previous: RunRecord,
  saved: RunRecord,
  options: RequiredStatusEventOptions = {}
): Promise<RunRecord> {
  try {
    await appendRunStatusChanged(saved, options);
    return saved;
  } catch (error) {
    try {
      await getRunRepository().save(previous);
      throw new RunPersistenceConsistencyError(
        `Required status event append failed for run ${saved.runId}; RunRecord rollback to ${previous.status} succeeded.`,
        {
          runId: saved.runId,
          previousStatus: previous.status,
          attemptedStatus: saved.status,
          rollback: "succeeded",
          cause: error
        }
      );
    } catch (rollbackError) {
      if (rollbackError instanceof RunPersistenceConsistencyError) {
        throw rollbackError;
      }
      console.error(`[runs] persistence inconsistency: rollback failed for run ${saved.runId}`, {
        attemptedStatus: saved.status,
        previousStatus: previous.status,
        eventError: error,
        rollbackError
      });
      throw new RunPersistenceConsistencyError(
        `Required status event append failed for run ${saved.runId}; RunRecord rollback also failed.`,
        {
          runId: saved.runId,
          previousStatus: previous.status,
          attemptedStatus: saved.status,
          rollback: "failed",
          cause: error,
          rollbackCause: rollbackError
        }
      );
    }
  }
}

export async function appendStatusAndRunEventsOrRollback(
  previous: RunRecord,
  saved: RunRecord,
  additionalEvents: readonly RunModelEventInput[],
  options: RequiredStatusEventOptions = {}
): Promise<RunRecord> {
  const at = options.at ?? saved.updatedAt;
  try {
    await appendRunEventsRequired(saved.runId, [
      {
        actor: options.actor ?? "system",
        at,
        type: "run.status.changed",
        payload: runControlForRun(saved)
      },
      ...additionalEvents
    ]);
    publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at });
    return saved;
  } catch (error) {
    try {
      await getRunRepository().save(previous);
      throw new RunPersistenceConsistencyError(
        `Required event append failed for run ${saved.runId}; RunRecord rollback to ${previous.status} succeeded.`,
        {
          runId: saved.runId,
          previousStatus: previous.status,
          attemptedStatus: saved.status,
          rollback: "succeeded",
          cause: error
        }
      );
    } catch (rollbackError) {
      if (rollbackError instanceof RunPersistenceConsistencyError) {
        throw rollbackError;
      }
      console.error(`[runs] persistence inconsistency: rollback failed for run ${saved.runId}`, {
        attemptedStatus: saved.status,
        previousStatus: previous.status,
        eventError: error,
        rollbackError
      });
      throw new RunPersistenceConsistencyError(
        `Required event append failed for run ${saved.runId}; RunRecord rollback also failed.`,
        {
          runId: saved.runId,
          previousStatus: previous.status,
          attemptedStatus: saved.status,
          rollback: "failed",
          cause: error,
          rollbackCause: rollbackError
        }
      );
    }
  }
}
