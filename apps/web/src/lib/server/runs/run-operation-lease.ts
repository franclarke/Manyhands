import { randomUUID } from "node:crypto";
import type { RunLifecycle } from "@manyhands/run-coordinator";
import {
  JsonlRunEventStore,
  StaleFencingTokenError,
  type FencedRunEventStore
} from "@manyhands/run-store";

import { RunMutationConflictError } from "./errors";
import { abortRun } from "./run-abort-registry";
import { killRunProcessesVerified } from "./process-evidence";
import { RepoLeaseLostError, withRepositoryLease } from "./repo-lock";
import type { RunRepository } from "./repository";
import type {
  RunOperationKind,
  RunOperationLease,
  RunRecord,
  RunTakeoverReceipt
} from "./schema";
import { getRunRepository } from "./store";
import { resolveRunsDirectory } from "./runs-directory";
import { resolveRunTargetPath } from "./target-context";

export interface ClaimRunOperationOptions {
  expectedLifecycles: readonly RunLifecycle[];
  expectedVersion?: number;
  allowTakeover?: boolean;
  takeoverStaleAfterMs?: number;
  operationId?: string;
  now?: string;
}

export interface TakeoverProcessReceipt {
  processReceiptId: string;
  allDead: boolean;
  processCount: number;
}

export interface RunOperationAuthorityDependencies {
  repository: RunRepository;
  events: FencedRunEventStore;
  operationId?: () => string;
  reconcileTakeover?: (input: {
    runId: string;
    superseded: RunOperationLease;
  }) => Promise<TakeoverProcessReceipt>;
  reconcileRepository?: (input: {
    run: RunRecord;
    superseded: RunOperationLease;
  }) => Promise<boolean>;
}

/**
 * Deep module for operation authority.
 *
 * The RunRecord mutation lock serializes every claim and cache write. While
 * that lock is held, claim() first mints the canonical event-store fence,
 * reconciles any superseded process tree, and only then publishes the
 * RunRecord lease. A crash between the fence and record publication therefore
 * leaves an orphaned higher fence (safe/unavailable), never two writers.
 */
export class RunOperationAuthority {
  private readonly operationId: () => string;
  private readonly reconcileTakeover: NonNullable<RunOperationAuthorityDependencies["reconcileTakeover"]>;
  private readonly reconcileRepository: NonNullable<RunOperationAuthorityDependencies["reconcileRepository"]>;

  constructor(private readonly dependencies: RunOperationAuthorityDependencies) {
    this.operationId = dependencies.operationId ?? randomUUID;
    this.reconcileTakeover = dependencies.reconcileTakeover ?? reconcileRunProcesses;
    this.reconcileRepository = dependencies.reconcileRepository ?? reconcileRunRepository;
  }

  async claim(
    runId: string,
    kind: RunOperationKind,
    options: ClaimRunOperationOptions
  ): Promise<{ run: RunRecord; lease: RunOperationLease }> {
    let lease: RunOperationLease | undefined;
    const run = await this.dependencies.repository.update(runId, async (current) => {
      if (options.expectedVersion !== undefined && current.version !== options.expectedVersion) {
        throw conflict(runId, current, `version ${options.expectedVersion} is stale (current ${current.version})`);
      }
      if (!options.expectedLifecycles.includes(current.projection.lifecycle)) {
        throw conflict(runId, current, `lifecycle ${current.projection.lifecycle} cannot start ${kind}`);
      }
      const superseded = current.activeOperation;
      if (superseded !== undefined && options.allowTakeover !== true) {
        throw conflict(runId, current, `operation ${superseded.operationId}/${superseded.fencingToken} is active`);
      }
      if (
        superseded !== undefined &&
        options.allowTakeover === true &&
        options.takeoverStaleAfterMs !== undefined &&
        isRunOperationFresh(superseded, options.takeoverStaleAfterMs, options.now)
      ) {
        throw conflict(runId, current, `operation ${superseded.operationId}/${superseded.fencingToken} has a fresh heartbeat`);
      }

      const now = options.now ?? new Date().toISOString();
      const operationId = options.operationId ?? this.operationId();
      let takeoverProcessReceipt: TakeoverProcessReceipt | undefined;
      let publishedAt = now;
      if (superseded !== undefined) {
        const processReceipt = await this.reconcileTakeover({ runId, superseded });
        if (!processReceipt.allDead) {
          throw conflict(
            runId,
            current,
            `takeover of ${superseded.operationId}/${superseded.fencingToken} did not verify allDead`
          );
        }
        if (!await this.reconcileRepository({ run: current, superseded })) {
          throw conflict(
            runId,
            current,
            `takeover of ${superseded.operationId}/${superseded.fencingToken} did not quiesce repository effects`
          );
        }
        takeoverProcessReceipt = processReceipt;
        publishedAt = new Date().toISOString();
      }

      // Do not fence the current owner until process and repository takeover
      // checks have both succeeded. A failed takeover must leave the original
      // authority usable; otherwise the old runner becomes stale while the
      // new control operation is rejected, leaving the run permanently stuck.
      const canonical = await this.dependencies.events.claimAuthority(
        runId,
        operationId,
        Math.max(current.mutationFence ?? 0, superseded?.fencingToken ?? 0)
      );
      lease = {
        operationId: canonical.operationId,
        kind,
        fencingToken: canonical.fencingToken,
        acquiredAt: now,
        heartbeatAt: publishedAt
      };

      const takeoverReceipt: RunTakeoverReceipt | undefined = takeoverProcessReceipt === undefined || superseded === undefined
        ? undefined
        : {
            processReceiptId: takeoverProcessReceipt.processReceiptId,
            supersededOperationId: superseded.operationId,
            supersededFencingToken: superseded.fencingToken,
            operationId: lease.operationId,
            fencingToken: lease.fencingToken,
            allDead: takeoverProcessReceipt.allDead,
            repositoryQuiescent: true,
            processCount: takeoverProcessReceipt.processCount,
            verifiedAt: publishedAt
          };

      return {
        ...current,
        mutationFence: lease.fencingToken,
        activeOperation: lease,
        heartbeatAt: publishedAt,
        ...(takeoverReceipt === undefined ? {} : { lastTakeoverReceipt: takeoverReceipt })
      };
    });
    return { run, lease: lease! };
  }

  update(
    runId: string,
    lease: RunOperationLease,
    mutate: (current: RunRecord) => RunRecord
  ): Promise<RunRecord> {
    return this.dependencies.repository.update(runId, async (current) => {
      try {
        await this.dependencies.events.assertAuthority(runId, authority(lease));
      } catch (error) {
        if (error instanceof StaleFencingTokenError) {
          throw conflict(
            runId,
            current,
            `operation ${lease.operationId}/${lease.fencingToken} no longer owns the canonical fence`
          );
        }
        throw error;
      }
      assertLease(runId, current, lease);
      return mutate(current);
    });
  }

  async assertCurrent(
    runId: string,
    lease: Pick<RunOperationLease, "operationId" | "fencingToken">
  ): Promise<RunRecord> {
    await this.dependencies.events.assertAuthority(runId, authority(lease));
    const current = await this.dependencies.repository.get(runId);
    assertLease(runId, current, lease);
    return current;
  }

  async release(runId: string, lease: RunOperationLease): Promise<RunRecord> {
    try {
      return await this.update(runId, lease, (current) => {
        const next = { ...current };
        delete next.activeOperation;
        return next;
      });
    } catch (error) {
      if (
        error instanceof RunMutationConflictError ||
        error instanceof StaleFencingTokenError
      ) {
        return this.dependencies.repository.get(runId);
      }
      throw error;
    }
  }
}

export async function claimRunOperation(
  runId: string,
  kind: RunOperationKind,
  options: ClaimRunOperationOptions
): Promise<{ run: RunRecord; lease: RunOperationLease }> {
  return defaultAuthority().claim(runId, kind, options);
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

export function updateRunForOperation(
  runId: string,
  lease: RunOperationLease,
  mutate: (current: RunRecord) => RunRecord
): Promise<RunRecord> {
  return defaultAuthority().update(runId, lease, mutate);
}

export function assertRunOperationCurrent(
  runId: string,
  lease: Pick<RunOperationLease, "operationId" | "fencingToken">
): Promise<RunRecord> {
  return defaultAuthority().assertCurrent(runId, lease);
}

/** Legacy pure transform. Productive invalidation must claim canonical authority. */
export function invalidateRunOperation(current: RunRecord): RunRecord {
  const next = {
    ...current,
    mutationFence: Math.max(current.mutationFence ?? 0, current.activeOperation?.fencingToken ?? 0) + 1
  };
  delete next.activeOperation;
  return next;
}

export function renewRunOperation(
  runId: string,
  lease: RunOperationLease,
  at = new Date().toISOString()
): Promise<RunRecord> {
  return updateRunForOperation(runId, lease, (current) => ({
    ...current,
    heartbeatAt: at,
    activeOperation: { ...lease, heartbeatAt: at }
  }));
}

export function releaseRunOperation(runId: string, lease: RunOperationLease): Promise<RunRecord> {
  return defaultAuthority().release(runId, lease);
}

export async function releaseRunOperationWithRetry(
  runId: string,
  lease: RunOperationLease,
  options: {
    release?: typeof releaseRunOperation;
    sleep?: (ms: number) => Promise<void>;
    retryDelaysMs?: readonly number[];
  } = {}
): Promise<RunRecord> {
  const release = options.release ?? releaseRunOperation;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delays = options.retryDelaysMs ?? [10, 50, 200];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await release(runId, lease);
    } catch (error) {
      lastError = error;
      if (attempt === delays.length) break;
      await sleep(delays[attempt]!);
    }
  }
  throw lastError;
}

export function isVerifiedRunTakeover(
  run: RunRecord,
  lease: Pick<RunOperationLease, "operationId" | "fencingToken">
): boolean {
  return run.lastTakeoverReceipt?.operationId === lease.operationId &&
    run.lastTakeoverReceipt.fencingToken === lease.fencingToken &&
    run.lastTakeoverReceipt.allDead &&
    run.lastTakeoverReceipt.repositoryQuiescent === true;
}

function defaultAuthority(): RunOperationAuthority {
  const directory = resolveRunsDirectory();
  return new RunOperationAuthority({
    repository: getRunRepository(),
    events: new JsonlRunEventStore({ directory })
  });
}

async function reconcileRunProcesses(
  input: { runId: string; superseded: RunOperationLease }
): Promise<TakeoverProcessReceipt> {
  abortRun(input.runId);
  const report = await killRunProcessesVerified(input.runId);
  return {
    processReceiptId: `takeover:${randomUUID()}`,
    allDead: report.allDead,
    processCount: report.verifications.length
  };
}

async function reconcileRunRepository(
  input: { run: RunRecord; superseded: RunOperationLease }
): Promise<boolean> {
  if (
    input.superseded.kind !== "planning" &&
    input.superseded.kind !== "execution" &&
    input.superseded.kind !== "delivery"
  ) {
    return true;
  }
  const repoRoot = await resolveRunTargetPath(input.run).catch(() => undefined);
  if (repoRoot === undefined) return false;

  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await withRepositoryLease(
        { repoRoot, runId: input.run.runId },
        async () => undefined
      );
      return true;
    } catch (error) {
      if (!(error instanceof RepoLeaseLostError) || Date.now() >= deadline) {
        return false;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
}

function assertLease(
  runId: string,
  current: RunRecord,
  lease: Pick<RunOperationLease, "operationId" | "fencingToken">
): void {
  const active = current.activeOperation;
  if (
    active === undefined ||
    active.operationId !== lease.operationId ||
    active.fencingToken !== lease.fencingToken ||
    current.mutationFence !== lease.fencingToken
  ) {
    throw conflict(runId, current, `operation ${lease.operationId}/${lease.fencingToken} no longer owns the run`);
  }
}

function conflict(runId: string, current: RunRecord, reason: string): RunMutationConflictError {
  return new RunMutationConflictError(
    `Run ${runId} operation claim rejected: ${reason}.`,
    current.projection.lifecycle,
    current.version
  );
}

function authority(
  lease: Pick<RunOperationLease, "operationId" | "fencingToken">
): { operationId: string; fencingToken: number } {
  return {
    operationId: lease.operationId,
    fencingToken: lease.fencingToken
  };
}
