import { createHash } from "node:crypto";
import path from "node:path";
import { JsonFileCheckpointSaver } from "@manyhands/orchestrator-graph";
import {
  AmendmentsEngine,
  computeSeamInvalidationClosure
} from "@manyhands/execution-core";
import type { Amendment, AmendmentProposedPayload, RunEvent } from "@/lib/run-model/types";
import { buildDurableAmendmentEvents, type SeamAmendmentPatch } from "./amendment-durable-events";
import { RunLifecycleError } from "./errors";
import { resolveExecutionGraph } from "./execution-state";
import { finalizePersistedReplanMutation } from "./replan-service";
import {
  JsonPlanMutationJournal,
  PlanMutationConflictError,
  planMutationStatusAtLeast,
  type PlanMutationOperation,
  type PlanMutationStatus
} from "./plan-mutation-journal";
import { parseRunPatches } from "./patches";
import { withRepositoryLease } from "./repo-lock";
import { resolveRunsDirectory } from "./repository";
import {
  appendRunEventsRequired,
  readRunModelEvents
} from "./run-model-event-log";
import {
  assertRunOperationCurrent,
  claimRunOperation,
  isRunOperationFresh,
  releaseRunOperation
} from "./run-operation-lease";
import type { RunOperationLease, RunRecord } from "./schema";
import { getRunRepository } from "./store";
import { projectRunRecordToPlanGraph } from "./run-model-projection";

export interface AmendmentFinalizationDeps {
  afterCheckpointReset?: () => Promise<void> | void;
}

const RECOVERY_OPERATION_STALE_MS = 10 * 60 * 1_000;

export interface FinalizePersistedAmendmentInput {
  run: RunRecord;
  operation: PlanMutationOperation;
  lease: RunOperationLease;
  patch: SeamAmendmentPatch;
  amendment: Amendment;
  decisionId: string;
  at: string;
  deps?: AmendmentFinalizationDeps;
}

/**
 * Finish the repeatable post-CAS half of an amendment. Every side effect is
 * fenced and every boundary is journaled; direct execution and recovery call
 * this exact function and therefore publish identical event identities.
 */
export async function finalizePersistedAmendment(
  input: FinalizePersistedAmendmentInput
): Promise<PlanMutationOperation> {
  const journal = mutationJournal();
  let operation = await journal.get(input.operation.operationId) ?? input.operation;
  await assertDurableOperationEvidence(input.run.runId, operation, input.patch);

  if (!planMutationStatusAtLeast(operation.status, "worktrees_cleaned")) {
    await assertRunOperationCurrent(input.run.runId, input.lease);
    if (input.patch.changeKind === "signature") {
      const current = await getRunRepository().get(input.run.runId);
      const graph = resolveExecutionGraph(current);
      const invalidated = new Set(
        operation.invalidatedTaskIds ?? [...computeSeamInvalidationClosure(graph, input.patch.seamId)]
      );
      const provisioned = current.provisioned;
      if (provisioned === undefined) {
        throw new RunLifecycleError(
          `Run ${current.runId} has no provisioned repository for amendment cleanup.`
        );
      }
      await withRepositoryLease(
        { repoRoot: provisioned.repoRoot, runId: current.runId },
        async () => {
          await assertRunOperationCurrent(current.runId, input.lease);
          await new AmendmentsEngine().cleanInvalidatedTasks({
            repoRoot: provisioned.repoRoot,
            runId: current.runId,
            graph,
            invalidatedTaskIds: invalidated
          });
          await assertRunOperationCurrent(current.runId, input.lease);
        }
      );
    }
    operation = await advanceOperation(journal, operation.operationId, "worktrees_cleaned");
  }

  if (!planMutationStatusAtLeast(operation.status, "checkpoint_reset")) {
    await assertRunOperationCurrent(input.run.runId, input.lease);
    const checkpointer = new JsonFileCheckpointSaver(path.join(resolveRunsDirectory(), "checkpoints"));
    await checkpointer.deleteThread(input.run.runId);
    await assertRunOperationCurrent(input.run.runId, input.lease);
    operation = await advanceOperation(journal, operation.operationId, "checkpoint_reset");
    await input.deps?.afterCheckpointReset?.();
  }

  if (!planMutationStatusAtLeast(operation.status, "events_persisted")) {
    const current = await assertRunOperationCurrent(input.run.runId, input.lease);
    const projection = projectRunRecordToPlanGraph(current, { resetRuntime: true });
    if (projection === null) {
      throw new RunLifecycleError(`Run ${current.runId} has no durable amended graph to project.`);
    }
    await appendRunEventsRequired(
      current.runId,
      buildDurableAmendmentEvents({
        run: current,
        patch: input.patch,
        amendment: input.amendment,
        decisionId: input.decisionId,
        graphProjection: projection,
        at: input.at
      })
    );
    await assertRunOperationCurrent(current.runId, input.lease);
    operation = await advanceOperation(journal, operation.operationId, "events_persisted");
  }

  return advanceOperation(journal, operation.operationId, "completed");
}

/** Recover every durable plan mutation before approval/execution reads it. */
export async function recoverPendingAmendmentMutations(
  runId: string,
  knownRun?: RunRecord
): Promise<RunRecord> {
  const afterReplans = await recoverPendingReplanMutations(runId, knownRun);
  return recoverPendingSeamAmendments(runId, afterReplans);
}

async function recoverPendingReplanMutations(
  runId: string,
  knownRun?: RunRecord
): Promise<RunRecord> {
  const journal = mutationJournal();
  const pending = (await journal.pending(runId)).filter((entry) => entry.kind === "replan");
  if (pending.length === 0) return knownRun ?? getRunRepository().get(runId);

  for (const candidate of pending) {
    let run = await getRunRepository().get(runId);
    if (!hasReplanPatch(run, candidate)) {
      // Reservation precedes the RunRecord CAS. A prepared-only operation has
      // no authority to mutate or project anything and may still have a live
      // writer; leave it pending. Once journaled as record_persisted, missing
      // patch evidence is corruption and must fail loudly.
      if (!planMutationStatusAtLeast(candidate.status, "record_persisted")) {
        if (writerOwnsFreshMutation(run, candidate)) continue;
        await failAbandonedPreparedMutation(journal, run, candidate);
        continue;
      }
      throw new RunLifecycleError(
        `Replan mutation ${candidate.operationId} says record_persisted but its durable patch is missing.`
      );
    }

    let operation = candidate;
    if (operation.status === "completed" || operation.status === "failed") continue;
    if (
      run.activeOperation !== undefined &&
      isRunOperationFresh(run.activeOperation, RECOVERY_OPERATION_STALE_MS)
    ) {
      continue;
    }
    if (!planMutationStatusAtLeast(operation.status, "record_persisted")) {
      operation = await advanceOperation(journal, operation.operationId, "record_persisted");
    }

    let claimed: Awaited<ReturnType<typeof claimRunOperation>>;
    try {
      claimed = await claimRunOperation(runId, "replan", {
        expectedStatuses: ["needs_review"],
        allowTakeover: true,
        takeoverStaleAfterMs: RECOVERY_OPERATION_STALE_MS
      });
    } catch (error) {
      const latest = await getRunRepository().get(runId);
      if (
        latest.activeOperation !== undefined &&
        isRunOperationFresh(latest.activeOperation, RECOVERY_OPERATION_STALE_MS)
      ) {
        continue;
      }
      throw error;
    }

    try {
      run = claimed.run;
      await finalizePersistedReplanMutation({
        run,
        operation,
        lease: claimed.lease
      });
    } finally {
      await releaseRunOperation(runId, claimed.lease).catch(() => undefined);
    }
  }
  return getRunRepository().get(runId);
}

async function recoverPendingSeamAmendments(
  runId: string,
  knownRun?: RunRecord
): Promise<RunRecord> {
  const journal = mutationJournal();
  const pending = (await journal.pending(runId)).filter((entry) => entry.kind === "amendment");
  if (pending.length === 0 && knownRun !== undefined) return knownRun;
  for (const candidate of pending) {
    let run = await getRunRepository().get(runId);
    const patch = seamPatchForOperation(run, candidate);
    if (patch === undefined) {
      // A live writer may still be between journal reservation and the
      // RunRecord CAS. Leave prepared-only intent pending instead of racing it
      // to a terminal status; only durable patch evidence authorizes recovery.
      if (!planMutationStatusAtLeast(candidate.status, "record_persisted")) {
        if (!writerOwnsFreshMutation(run, candidate)) {
          await failAbandonedPreparedMutation(journal, run, candidate);
        }
        continue;
      }
      throw new RunLifecycleError(
        `Plan mutation ${candidate.operationId} says record_persisted but patch evidence is missing.`
      );
    }
    let operation = candidate;
    if (operation.status === "completed" || operation.status === "failed") continue;

    // ensureRunModelEventLogForRun may race the direct post-CAS finalizer. A
    // read/reconciliation path must never fence a writer whose durable
    // heartbeat is still live. The claim below repeats this check under CAS.
    if (
      run.activeOperation !== undefined &&
      isRunOperationFresh(run.activeOperation, RECOVERY_OPERATION_STALE_MS)
    ) {
      continue;
    }
    if (!planMutationStatusAtLeast(operation.status, "record_persisted")) {
      operation = await advanceOperation(journal, operation.operationId, "record_persisted");
    }

    const evidence = await amendmentEvidence(run, operation, patch);
    let claimed: Awaited<ReturnType<typeof claimRunOperation>>;
    try {
      claimed = await claimRunOperation(runId, "replan", {
        expectedStatuses: ["needs_review", "approved"],
        allowTakeover: true,
        takeoverStaleAfterMs: RECOVERY_OPERATION_STALE_MS
      });
    } catch (error) {
      const latest = await getRunRepository().get(runId);
      if (
        latest.activeOperation !== undefined &&
        isRunOperationFresh(latest.activeOperation, RECOVERY_OPERATION_STALE_MS)
      ) {
        continue;
      }
      throw error;
    }
    try {
      run = claimed.run;
      await assertDurableOperationEvidence(runId, operation, patch);
      await finalizePersistedAmendment({
        run,
        operation,
        lease: claimed.lease,
        patch,
        amendment: evidence.amendment,
        decisionId: evidence.decisionId,
        at: evidence.at
      });
    } finally {
      await releaseRunOperation(runId, claimed.lease).catch(() => undefined);
    }
  }
  return getRunRepository().get(runId);
}

export async function hasPendingAmendmentMutation(runId: string): Promise<boolean> {
  return (await mutationJournal().pending(runId)).some((entry) => entry.kind === "amendment");
}

export async function hasPendingPlanMutation(runId: string): Promise<boolean> {
  return (await mutationJournal().pending(runId)).length > 0;
}

function hasReplanPatch(run: RunRecord, operation: PlanMutationOperation): boolean {
  const patches = parseRunPatches(run.patches).filter((patch) => patch.type === "SUBTREE_REGENERATED");
  return operation.patchId === undefined
    ? patches.length > 0
    : patches.some((patch) => patch.id === operation.patchId);
}

function writerOwnsFreshMutation(run: RunRecord, operation: PlanMutationOperation): boolean {
  const active = run.activeOperation;
  if (active === undefined || !isRunOperationFresh(active, RECOVERY_OPERATION_STALE_MS)) return false;
  // New journal entries persist the exact RunOperation identity. Legacy
  // prepared entries did not, so conservatively treat any fresh owner as live.
  return operation.runOperationId === undefined || active.operationId === operation.runOperationId;
}

async function failAbandonedPreparedMutation(
  journal: JsonPlanMutationJournal,
  run: RunRecord,
  operation: PlanMutationOperation
): Promise<void> {
  let recoveryLease: RunOperationLease | undefined;
  const active = run.activeOperation;
  const mayBeOriginalWriter =
    active !== undefined &&
    (operation.runOperationId === undefined || active.operationId === operation.runOperationId);
  if (mayBeOriginalWriter) {
    try {
      const claimed = await claimRunOperation(run.runId, "replan", {
        expectedStatuses: [run.status],
        allowTakeover: true,
        takeoverStaleAfterMs: RECOVERY_OPERATION_STALE_MS
      });
      recoveryLease = claimed.lease;
    } catch (error) {
      const latest = await getRunRepository().get(run.runId);
      if (writerOwnsFreshMutation(latest, operation)) return;
      throw error;
    }
  }

  try {
    const latest = await journal.get(operation.operationId);
    if (latest === undefined || latest.status === "failed" || latest.status === "completed") return;
    if (planMutationStatusAtLeast(latest.status, "record_persisted")) return;
    await journal.transition(latest.operationId, {
      expectedVersion: latest.version,
      status: "failed",
      error: "Plan-mutation writer ended before the RunRecord CAS; fenced during recovery."
    });
  } finally {
    if (recoveryLease !== undefined) {
      await releaseRunOperation(run.runId, recoveryLease).catch(() => undefined);
    }
  }
}

function mutationJournal(): JsonPlanMutationJournal {
  return new JsonPlanMutationJournal({ directory: path.join(resolveRunsDirectory(), "plan-mutations") });
}

async function assertDurableOperationEvidence(
  runId: string,
  operation: PlanMutationOperation,
  patch: SeamAmendmentPatch
): Promise<void> {
  const current = await getRunRepository().get(runId);
  if ((current.planRevision ?? 1) !== operation.targetPlanRevision) {
    throw new RunLifecycleError(
      `Plan mutation ${operation.operationId} targets revision ${operation.targetPlanRevision}, ` +
      `but run ${runId} is revision ${current.planRevision ?? 1}.`
    );
  }
  if (
    operation.targetFingerprint !== undefined &&
    current.targetContext?.fingerprint !== operation.targetFingerprint
  ) {
    throw new RunLifecycleError(
      `Run ${runId} target no longer matches plan mutation ${operation.operationId}.`
    );
  }
  if (!(current.patches ?? []).some((value) => patchId(value) === patch.id)) {
    throw new RunLifecycleError(`Run ${runId} is missing durable patch ${patch.id}.`);
  }
  const graphHash = createHash("sha256")
    .update(JSON.stringify(resolveExecutionGraph(current)))
    .digest("hex");
  if (graphHash !== operation.graphHash) {
    throw new RunLifecycleError(`Run ${runId} graph does not match plan mutation ${operation.operationId}.`);
  }
}

function seamPatchForOperation(
  run: RunRecord,
  operation: PlanMutationOperation
): SeamAmendmentPatch | undefined {
  const patches = parseRunPatches(run.patches);
  if (operation.patchId !== undefined) {
    const exact = patches.find(
      (patch) => patch.id === operation.patchId && patch.type === "SEAM_AMENDED"
    );
    return exact?.type === "SEAM_AMENDED" ? exact : undefined;
  }
  const candidates = patches.filter((patch): patch is SeamAmendmentPatch => patch.type === "SEAM_AMENDED");
  return candidates.at(-1);
}

async function amendmentEvidence(
  run: RunRecord,
  operation: PlanMutationOperation,
  patch: SeamAmendmentPatch
): Promise<{ amendment: Amendment; decisionId: string; at: string }> {
  const events = await readRunModelEvents(run.runId);
  const amendmentId = operation.amendmentId ?? patch.amendmentId;
  const proposal = [...events].reverse().find((event) =>
    event.type === "amendment.proposed" &&
    (amendmentId === undefined || event.payload.amendmentId === amendmentId)
  );
  const payload = proposal?.payload as AmendmentProposedPayload | undefined;
  const resolvedAmendmentId = amendmentId ?? payload?.amendmentId;
  if (resolvedAmendmentId === undefined) {
    throw new RunLifecycleError(`Plan mutation ${operation.operationId} has no amendment identity.`);
  }
  const graph = resolveExecutionGraph(run);
  const producerNodeId = Object.values(graph.nodes).find((node) =>
    (node.contract?.producedInterfaces ?? []).some((iface) => iface.id === patch.seamId)
  )?.id;
  const amendment: Amendment = payload !== undefined
    ? {
        id: payload.amendmentId,
        nodeId: payload.nodeId,
        kind: payload.kind,
        changeKind: payload.changeKind,
        detail: structuredClone(payload.detail),
        affects: [...payload.affects],
        status: "proposed"
      }
    : {
        id: resolvedAmendmentId,
        nodeId: patch.nodeId ?? producerNodeId ?? graph.rootId,
        kind: "seam",
        changeKind: patch.changeKind,
        detail: {
          seamId: patch.seamId,
          fromRevision: patch.fromRevision,
          toRevision: patch.toRevision,
          ...(patch.signature !== undefined ? { newSignature: patch.signature } : {}),
          ...(patch.contract !== undefined ? { contract: patch.contract } : {})
        },
        affects: [...(patch.affects ?? operation.invalidatedTaskIds ?? [])],
        status: "proposed"
      };
  const decisionId = operation.decisionId ?? patch.decisionId ?? decisionForAmendment(events, resolvedAmendmentId);
  if (decisionId === undefined) {
    throw new RunLifecycleError(`Amendment ${resolvedAmendmentId} has no approval decision identity.`);
  }
  return { amendment, decisionId, at: patch.createdAt };
}

function decisionForAmendment(events: RunEvent[], amendmentId: string): string | undefined {
  const match = [...events].reverse().find((event) => {
    if (event.type !== "decision.raised") return false;
    const payload = event.payload as {
      kind?: unknown;
      context?: { amendmentId?: unknown };
    };
    return payload.kind === "approve_amendment" && payload.context?.amendmentId === amendmentId;
  });
  const decisionId = match === undefined
    ? undefined
    : (match.payload as { decisionId?: unknown }).decisionId;
  return typeof decisionId === "string" ? decisionId : undefined;
}

async function advanceOperation(
  journal: JsonPlanMutationJournal,
  operationId: string,
  status: PlanMutationStatus
): Promise<PlanMutationOperation> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latest = await journal.get(operationId);
    if (latest === undefined) throw new PlanMutationConflictError(`Unknown plan mutation ${operationId}.`);
    if (latest.status === "failed") {
      throw new PlanMutationConflictError(`Plan mutation ${operationId} is already failed.`);
    }
    if (planMutationStatusAtLeast(latest.status, status)) return latest;
    try {
      return await journal.transition(operationId, { expectedVersion: latest.version, status });
    } catch (error) {
      if (!(error instanceof PlanMutationConflictError) || attempt === 3) throw error;
    }
  }
  throw new PlanMutationConflictError(`Could not advance plan mutation ${operationId}.`);
}

function patchId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : undefined;
}
