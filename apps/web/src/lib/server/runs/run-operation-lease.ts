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
  expectedVersion?: number;
  /** Explicit recovery path after a crashed/restarted runner. */
  allowTakeover?: boolean;
  /** When set, takeover is still rejected while the durable owner heartbeat is fresh. */
  takeoverStaleAfterMs?: number;
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
    if (options.expectedVersion !== undefined && current.version !== options.expectedVersion) {
      throw conflict(runId, current, `version ${options.expectedVersion} is stale (current version is ${current.version})`);
    }
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
    if (
      current.activeOperation !== undefined &&
      options.allowTakeover === true &&
      options.takeoverStaleAfterMs !== undefined &&
      isRunOperationFresh(current.activeOperation, options.takeoverStaleAfterMs, options.now)
    ) {
      throw conflict(
        runId,
        current,
        `operation ${current.activeOperation.operationId}/${current.activeOperation.fencingToken} still has a fresh heartbeat`
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

export function isRunOperationFresh(
  lease: RunOperationLease,
  staleAfterMs: number,
  now: string | number = Date.now()
): boolean {
  const heartbeatMs = Date.parse(lease.heartbeatAt);
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  return Number.isFinite(heartbeatMs) && Number.isFinite(nowMs) && nowMs - heartbeatMs < staleAfterMs;
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

/** Read-only fencing check immediately before/after a non-RunRecord side effect. */
export async function assertRunOperationCurrent(
  runId: string,
  lease: Pick<RunOperationLease, "operationId" | "fencingToken">
): Promise<RunRecord> {
  const current = await getRunRepository().get(runId);
  const active = current.activeOperation;
  if (
    active === undefined ||
    active.operationId !== lease.operationId ||
    active.fencingToken !== lease.fencingToken ||
    current.mutationFence !== lease.fencingToken
  ) {
    throw conflict(
      runId,
      current,
      `operation ${lease.operationId}/${lease.fencingToken} no longer owns the run`
    );
  }
  return current;
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

export interface ReleaseRunOperationRetryOptions {
  release?: typeof releaseRunOperation;
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RELEASE_RETRY_DELAYS_MS = [10, 50, 200] as const;

/** Idempotent bounded retry for transient storage failures during owner cleanup. */
export async function releaseRunOperationWithRetry(
  runId: string,
  lease: RunOperationLease,
  options: ReleaseRunOperationRetryOptions = {}
): Promise<RunRecord> {
  const release = options.release ?? releaseRunOperation;
  const sleepFor = options.sleep ?? (async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RELEASE_RETRY_DELAYS_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await release(runId, lease);
    } catch (error) {
      lastError = error;
      if (attempt === retryDelays.length) break;
      await sleepFor(retryDelays[attempt]!);
    }
  }
  throw lastError;
}

function conflict(runId: string, current: RunRecord, reason: string): RunMutationConflictError {
  return new RunMutationConflictError(
    `Run ${runId} operation claim rejected: ${reason}.`,
    current.status,
    current.version
  );
}
