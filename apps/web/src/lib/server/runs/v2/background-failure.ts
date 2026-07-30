import {
  RunCoordinator,
  foldRun,
  type RunLifecycle
} from "@manyhands/run-coordinator";
import {
  EventStoreCompactor,
  JsonlRunEventStore,
  RunSnapshotStore
} from "@manyhands/run-store";

import { RunMutationConflictError } from "../errors";
import { DEFAULT_STALE_MS } from "../interrupted";
import {
  claimRunOperation,
  releaseRunOperationWithRetry,
  updateRunForOperation
} from "../run-operation-lease";
import { resolveRunsDirectory } from "../runs-directory";
import { getRunRepository } from "../store";
import type { RunOperationLease } from "../schema";
import { projectV2RunRecordCache } from "./run-record-cache";

const ACTIVE_LIFECYCLES: readonly RunLifecycle[] = ["planning", "running", "waiting_for_input"];

/**
 * Converts a background runner rejection into one fenced, durable terminal
 * event. A normal decision wait is deliberately left alone: the driver can
 * finish its task while the run remains waiting for operator input.
 */
export async function markRunFailedAfterBackgroundTask(
  runId: string,
  error: unknown,
  area: "execution" | "artifact" | "delivery" | "domain",
  failedOperation?: Pick<RunOperationLease, "operationId" | "fencingToken">
): Promise<void> {
  if (error instanceof RunMutationConflictError) return;
  const events = new JsonlRunEventStore({ directory: resolveRunsDirectory() });
  const initial = foldRun(await events.load(runId));
  if (
    !ACTIVE_LIFECYCLES.includes(initial.lifecycle) ||
    (area !== "execution" && hasPendingDecision(initial))
  ) return;

  const currentRun = await getRunRepository().get(runId);
  const currentOperation = currentRun.activeOperation;
  let lease: RunOperationLease;
  if (
    failedOperation !== undefined &&
    currentOperation !== undefined &&
    (currentOperation.operationId !== failedOperation.operationId ||
      currentOperation.fencingToken !== failedOperation.fencingToken)
  ) {
      // A later operation owns the run. The rejected task is stale and must
      // not be allowed to fail its successor.
    return;
  }
  if (failedOperation !== undefined && currentOperation !== undefined) {
    lease = currentOperation;
  } else {
    try {
      const claimed = await claimRunOperation(runId, "control", {
        expectedLifecycles: ACTIVE_LIFECYCLES,
        allowTakeover: true,
        takeoverStaleAfterMs: DEFAULT_STALE_MS
      });
      lease = claimed.lease;
    } catch (claimError) {
      // A concurrent successful transition or a fresh operation won the race.
      // The durable owner is authoritative; never turn that race into a
      // second failure or an unhandled background rejection.
      if (claimError instanceof RunMutationConflictError) return;
      throw claimError;
    }
  }

  try {
    const currentEvents = await events.load(runId);
    const current = foldRun(currentEvents);
    if (
      !ACTIVE_LIFECYCLES.includes(current.lifecycle) ||
      (area !== "execution" && hasPendingDecision(current))
    ) return;

    const authority = { operationId: lease.operationId, fencingToken: lease.fencingToken };
    const reason = error instanceof Error ? error.message : String(error);
    const state = await new RunCoordinator({
      events: events.bind(authority),
      delivery: { publish: async () => { throw new Error("Delivery is not available while recording a background failure."); } },
      clock: () => new Date().toISOString(),
      eventId: (type, sequence) => `${runId}:${type}:${sequence}`
    }).execute(runId, { type: "fail", reason, area });
    const persisted = await events.load(runId);
    await new RunSnapshotStore({ directory: resolveRunsDirectory(), events }).write(
      runId,
      authority,
      state,
      state.sequence,
      persisted.at(-1)!.eventId
    );
    await new EventStoreCompactor(events).compactIfNeeded(runId, authority);
    await updateRunForOperation(runId, lease, (currentRun) =>
      projectV2RunRecordCache(currentRun, state, persisted)
    );
  } finally {
    await releaseRunOperationWithRetry(runId, lease);
  }
}

function hasPendingDecision(state: ReturnType<typeof foldRun>): boolean {
  return Object.values(state.decisions).some((decision) => decision.status === "pending");
}
