/**
 * Idempotent HITL mutation claims (INV-4).
 *
 * Every run mutation triggered by a human decision (resume, restart, answer,
 * approval, decision resolution) races against: the same decision sent twice
 * (double-click, two tabs), a different decision on the same gate, or a
 * pipeline that already moved the run on. The claim pattern closes all three:
 *
 *   1. The expectation is checked against the FRESH record inside the per-run
 *      write lock (`RunRepository.update`), never against a snapshot read in
 *      the route handler.
 *   2. The mutator must CONSUME the claim — clear the pending gate, transition
 *      the status — so a second identical claim fails its own expectation and
 *      surfaces as a deterministic 409 (`RunMutationConflictError`).
 *
 * Routes claim first, then kick the async pipeline. Exactly one claimant wins.
 */
import { RunMutationConflictError } from "./errors";
import { isRunnerActive } from "./runner-state";
import { getRunRepository } from "./store";
import type { RunOperationLease, RunRecord, RunStatus } from "./schema";

export interface RunMutationExpectation {
  /** The run must currently be in one of these statuses. */
  status?: readonly RunStatus[];
  pausedDuring?: "generating" | "running";
  /**
   * Requires a pendingDecision. `"any"` accepts whichever gate is suspended;
   * a concrete id must match the persisted `pendingDecision.gateId` (legacy
   * pauses without a gateId accept any claim — state expectations still hold).
   */
  pendingDecisionGateId?: string | "any";
  /** Requires a pendingQuestion; a concrete nodeId must match it. */
  pendingQuestionNodeId?: string | "any";
  /** Optimistic concurrency: reject when the persisted version moved past this. */
  version?: number;
  /** Reject while an in-process runner is actively driving this run. */
  rejectActiveRunner?: boolean;
  /**
   * Reject while a durable operation owner has a heartbeat newer than this
   * threshold. Unlike `rejectActiveRunner`, this is cross-process and is
   * checked against the fresh record inside the repository write lock.
   * Stale owners remain eligible for an explicit fenced recovery takeover.
   */
  rejectFreshOperationAfterMs?: number;
  /** Fence a background writer to the exact persisted operation owner. */
  operationLease?: Pick<RunOperationLease, "operationId" | "fencingToken">;
}

/**
 * Atomically verify `expectation` against the persisted record and apply
 * `mutate` in one locked read-modify-write. Throws RunMutationConflictError
 * (→ 409) when any expectation fails; throws RunNotFoundError passthrough.
 */
export async function claimRunMutation(
  runId: string,
  expectation: RunMutationExpectation,
  mutate: (current: RunRecord) => RunRecord
): Promise<RunRecord> {
  if (expectation.rejectActiveRunner === true && isRunnerActive(runId)) {
    const current = await getRunRepository().get(runId);
    throw new RunMutationConflictError(
      `Run ${runId} is being driven by an active runner; wait for it to pause or finish.`,
      current.status,
      current.version
    );
  }
  return getRunRepository().update(runId, (current) => {
    assertExpectation(runId, current, expectation);
    return mutate(current);
  });
}

function assertExpectation(runId: string, current: RunRecord, expectation: RunMutationExpectation): void {
  const conflict = (reason: string): never => {
    throw new RunMutationConflictError(
      `Run ${runId} mutation rejected: ${reason}.`,
      current.status,
      current.version
    );
  };

  if (expectation.status !== undefined && !expectation.status.includes(current.status)) {
    conflict(`status is "${current.status}" (expected ${expectation.status.map((s) => `"${s}"`).join(" | ")})`);
  }
  if (expectation.pausedDuring !== undefined && current.pausedDuring !== expectation.pausedDuring) {
    conflict(`run is not paused during "${expectation.pausedDuring}"`);
  }
  if (expectation.pendingDecisionGateId !== undefined) {
    if (current.pendingDecision === undefined) {
      conflict("the gate was already resolved by another request");
    } else if (
      expectation.pendingDecisionGateId !== "any" &&
      current.pendingDecision.gateId !== undefined &&
      current.pendingDecision.gateId !== expectation.pendingDecisionGateId
    ) {
      conflict(
        `gate "${expectation.pendingDecisionGateId}" is stale (current gate is "${current.pendingDecision.gateId}")`
      );
    }
  }
  if (expectation.pendingQuestionNodeId !== undefined) {
    if (current.pendingQuestion === undefined) {
      conflict("the question was already answered by another request");
    } else if (
      expectation.pendingQuestionNodeId !== "any" &&
      current.pendingQuestion.nodeId !== expectation.pendingQuestionNodeId
    ) {
      conflict(
        `question node "${expectation.pendingQuestionNodeId}" does not match the pending question ("${current.pendingQuestion.nodeId}")`
      );
    }
  }
  if (expectation.version !== undefined && current.version !== expectation.version) {
    conflict(`version ${expectation.version} is stale (current version is ${current.version})`);
  }
  if (
    expectation.rejectFreshOperationAfterMs !== undefined &&
    current.activeOperation !== undefined &&
    operationHeartbeatIsFresh(current.activeOperation, expectation.rejectFreshOperationAfterMs)
  ) {
    conflict(
      `active ${current.activeOperation.kind} operation ` +
        `${current.activeOperation.operationId}/${current.activeOperation.fencingToken} still has a fresh heartbeat`
    );
  }
  if (expectation.operationLease !== undefined) {
    const active = current.activeOperation;
    if (
      active === undefined ||
      active.operationId !== expectation.operationLease.operationId ||
      active.fencingToken !== expectation.operationLease.fencingToken ||
      current.mutationFence !== expectation.operationLease.fencingToken
    ) {
      conflict(
        `operation ${expectation.operationLease.operationId}/${expectation.operationLease.fencingToken} no longer owns the run`
      );
    }
  }
}

function operationHeartbeatIsFresh(operation: RunOperationLease, staleAfterMs: number): boolean {
  const heartbeatMs = Date.parse(operation.heartbeatAt);
  return Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs < staleAfterMs;
}
