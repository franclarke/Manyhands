import { randomUUID } from "node:crypto";

import { RunMutationConflictError } from "./errors";
import { claimRunMutation, type RunMutationExpectation } from "./mutation-guard";
import type {
  RunOperationKind,
  RunOperationLease,
  RunRecord,
  RunStatus
} from "./schema";
import { getRunRepository } from "./store";

export interface ClaimRunOperationOptions {
  expectedStatuses: readonly RunStatus[];
  /** Explicit recovery path after a crashed/restarted runner. */
  allowTakeover?: boolean;
  operationId?: string;
  now?: string;
}

export async function claimRunOperation(
  runId: string,
  kind: RunOperationKind,
  options: ClaimRunOperationOptions
): Promise<{ run: RunRecord; lease: RunOperationLease }> {
  let lease: RunOperationLease | undefined;
  const run = await getRunRepository().update(runId, (current) => {
    if (!options.expectedStatuses.includes(current.status)) {
      throw conflict(runId, current, `status "${current.status}" cannot start ${kind}`);
    }
    if (current.activeOperation !== undefined && options.allowTakeover !== true) {
      throw conflict(
        runId,
        current,
        `operation ${current.activeOperation.operationId}/${current.activeOperation.fencingToken} is still active`
      );
    }
    const now = options.now ?? new Date().toISOString();
    lease = {
      operationId: options.operationId ?? randomUUID(),
      kind,
      fencingToken: (current.mutationFence ?? 0) + 1,
      acquiredAt: now,
      heartbeatAt: now
    };
    return {
      ...current,
      mutationFence: lease.fencingToken,
      activeOperation: lease,
      heartbeatAt: now
    };
  });
  return { run, lease: lease! };
}

export function mutateRunWithLease(
  runId: string,
  lease: RunOperationLease,
  expectation: Omit<RunMutationExpectation, "operationLease">,
  mutate: (current: RunRecord) => RunRecord
): Promise<RunRecord> {
  return claimRunMutation(
    runId,
    { ...expectation, operationLease: lease },
    mutate
  );
}

export function updateRunForOperation(
  runId: string,
  lease: RunOperationLease | undefined,
  mutate: (current: RunRecord) => RunRecord
): Promise<RunRecord> {
  return lease === undefined
    ? getRunRepository().update(runId, mutate)
    : mutateRunWithLease(runId, lease, {}, mutate);
}

export function invalidateRunOperation(current: RunRecord): RunRecord {
  const next: RunRecord = {
    ...current,
    mutationFence:
      Math.max(current.mutationFence ?? 0, current.activeOperation?.fencingToken ?? 0) + 1
  };
  delete next.activeOperation;
  return next;
}

export async function renewRunOperation(
  runId: string,
  lease: RunOperationLease,
  at: string = new Date().toISOString()
): Promise<RunRecord> {
  return mutateRunWithLease(runId, lease, {}, (current) => ({
    ...current,
    heartbeatAt: at,
    activeOperation: { ...lease, heartbeatAt: at }
  }));
}

export async function releaseRunOperation(
  runId: string,
  lease: RunOperationLease
): Promise<RunRecord> {
  try {
    return await mutateRunWithLease(runId, lease, {}, (current) => {
      const next = { ...current };
      delete next.activeOperation;
      return next;
    });
  } catch (error) {
    if (error instanceof RunMutationConflictError) {
      return getRunRepository().get(runId);
    }
    throw error;
  }
}

function conflict(runId: string, current: RunRecord, reason: string): RunMutationConflictError {
  return new RunMutationConflictError(
    `Run ${runId} operation claim rejected: ${reason}.`,
    current.status,
    current.version
  );
}
