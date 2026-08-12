import { randomUUID } from "node:crypto";

import {
  TransactionalDeliveryPublisher,
  deliveryRequestFingerprint,
  safeGitArgs,
  targetWorkingTreeIsClean,
  type TransactionalDeliveryApproval,
  type TransactionalDeliveryReceipt
} from "@manyhands/execution-core";
import {
  RunCoordinator,
  foldRun,
  type DeliveryApproval,
  type DeliveryReceipt,
  type RunCommand,
  type RunLifecycle,
  type RunProjection
} from "@manyhands/run-coordinator";
import { EventStoreCompactor, JsonlRunEventStore, RunSnapshotStore, verifyAndRecoverRunStore } from "@manyhands/run-store";

import { getRunRepository } from "../store";
import { DEFAULT_STALE_MS } from "../interrupted";
import { runWithProcessSupervision, supervisedExecFile } from "../process-supervision";
import { withRepositoryLease } from "../repo-lock";
import { abortRun, createRunAbort, disposeRunAbort } from "../run-abort-registry";
import { killRunProcessesVerified, type KillRunProcessesDeps } from "../process-evidence";
import {
  claimRunOperation,
  releaseRunOperationWithRetry,
  updateRunForOperation
} from "../run-operation-lease";
import { resolveRunsDirectory } from "../runs-directory";
import {
  RUN_STATUS_VALUES,
  type RunOperationKind,
  type RunOperationLease,
  type RunRecord
} from "../schema";
import { resolveRunTargetPath } from "../target-context";
import { projectV2RunRecordCache } from "./run-record-cache";

export interface CancellationResultV2 {
  run: RunRecord;
  state: RunProjection;
  allProcessesDead: boolean;
  processCount: number;
}

export async function loadRunProjectionV2(runId: string): Promise<RunProjection> {
  const store = eventStore();
  const recovery = await verifyAndRecoverRunStore(runId, { store });
  if (recovery.status === "corrupt") throw new Error(`Run ${runId} has a corrupt durable event store.`);
  return foldRun(await store.load(runId));
}

/**
 * Repair the disposable RunRecord projection from the canonical V2 journal.
 *
 * A process can append a terminal event and lose its record-cache write before
 * a takeover fences it. The journal is authoritative, so reads must never
 * report the older cache as a live run or try to cancel an already terminal
 * execution.
 */
export async function reconcileRunRecordProjectionV2(run: RunRecord): Promise<RunRecord> {
  const store = eventStore();
  const recovery = await verifyAndRecoverRunStore(run.runId, { store });
  if (recovery.status === "corrupt") throw new Error(`Run ${run.runId} has a corrupt durable event store.`);
  const events = await store.load(run.runId);
  // Imported and legacy runs have a RunRecord but no V2 journal to project.
  // The record is their only durable representation, so preserving it is safer
  // than folding an empty event list into an invented lifecycle.
  if (events.length === 0) return run;
  const state = foldRun(events);
  if (state.sequence <= run.projection.eventSequence) return run;
  return getRunRepository().update(run.runId, (current) => {
    if (current.projection.eventSequence >= state.sequence) return current;
    return projectV2RunRecordCache(current, state, events);
  });
}

export async function resolveDecisionV2(
  runId: string,
  decisionId: string,
  resolution: { optionId?: string; answer?: string }
): Promise<{ run: RunRecord; state: RunProjection }> {
  const current = await loadRunProjectionV2(runId);
  const decision = current.decisions[decisionId];
  if (decision === undefined) throw new Error(`Decision ${decisionId} does not exist.`);
  if (decision.status !== "pending") throw new Error(`Decision ${decisionId} is already ${decision.status}.`);
  if (resolution.optionId !== undefined && !decision.options.some((option) => option.id === resolution.optionId)) {
    throw new Error(`Decision ${decisionId} has no option ${resolution.optionId}.`);
  }
  const result = await executeDecisionCommand(runId, {
    type: "resolve_decision",
    decisionId,
    ...resolution
  });
  if (resolution.optionId === "stop") {
    return executeDecisionCommand(runId, {
      type: "fail",
      reason: `The operator stopped the branch affected by decision ${decisionId}.`,
      area: "execution"
    });
  }
  return result;
}

async function executeDecisionCommand(runId: string, command: RunCommand): Promise<{ run: RunRecord; state: RunProjection }> {
  const current = await getRunRepository().get(runId);
  const activeExecution = current.activeOperation?.kind === "execution" ? current.activeOperation : undefined;
  if (activeExecution === undefined) {
    return executeCommand(runId, "control", ["planning", "needs_approval", "waiting_for_input", "running"], command);
  }
  const store = eventStore();
  const owner = authority(activeExecution);
  await store.assertAuthority(runId, owner);
  const state = await new RunCoordinator({
    events: store.bind(owner),
    delivery: unavailableDelivery,
    clock: () => new Date().toISOString(),
    eventId: eventIdFor(runId)
  }).execute(runId, command);
  return { run: await cacheProjection(runId, activeExecution, state, store), state };
}

export async function pauseRunV2(runId: string, reason: string): Promise<{ run: RunRecord; state: RunProjection; allProcessesDead: boolean }> {
  const { run, lease } = await claimControlOperation(runId, "execution");
  let allProcessesDead = true;
  try {
    const store = eventStore();
    abortRun(runId);
    const killed = await killRunProcessesVerified(runId);
    allProcessesDead = killed.allDead;
    const coordinator = coordinatorFor(run, lease, store);
    const state = await coordinator.execute(runId, { type: "pause", reason });
    return { run: await cacheProjection(runId, lease, state, store), state, allProcessesDead };
  } finally {
    await releaseRunOperationWithRetry(runId, lease);
  }
}

export async function resumeRunV2(runId: string, reason: string): Promise<{ run: RunRecord; state: RunProjection }> {
  return executeCommand(runId, "control", ["paused"], { type: "resume", reason });
}

export async function restartRunV2(runId: string, reason: string): Promise<{ run: RunRecord; state: RunProjection }> {
  return executeCommand(runId, "control", ["interrupted"], { type: "restart", reason });
}

export async function cancelRunV2(
  runId: string,
  reason: string,
  processDeps: KillRunProcessesDeps = {}
): Promise<CancellationResultV2> {
  const { lease } = await claimControlOperation(runId, "execution");
  let processCount = 0;
  let allProcessesDead = false;
  try {
    const store = eventStore();
    const coordinator = new RunCoordinator({
      events: store.bind(authority(lease)),
      delivery: unavailableDelivery,
      cancellation: {
        invalidateAuthority: async () => {
          abortRun(runId);
          return { invalidationReceiptId: `fence:${lease.fencingToken}` };
        },
        stopProcesses: async () => {
          const report = await killRunProcessesVerified(runId, processDeps);
          processCount = report.verifications.length;
          allProcessesDead = report.allDead;
          return { processReceiptId: `processes:${randomUUID()}`, allDead: report.allDead };
        }
      },
      clock: () => new Date().toISOString(),
      eventId: eventIdFor(runId)
    });
    const state = await coordinator.execute(runId, { type: "cancel", reason });
    return {
      run: await cacheProjection(runId, lease, state, store),
      state,
      allProcessesDead,
      processCount
    };
  } finally {
    await releaseRunOperationWithRetry(runId, lease);
  }
}

export async function deliverRunV2(runId: string, approval: DeliveryApproval): Promise<{ run: RunRecord; state: RunProjection }> {
  const store = eventStore();
  const initialEvents = await store.load(runId);
  const initialState = foldRun(initialEvents);
  if (initialState.lifecycle === "completed") {
    if (!sameApproval(initialState.deliveryApproval, approval) || initialState.deliveryReceipt === undefined) {
      throw new Error("The completed delivery belongs to a different approval.");
    }
    const run = await getRunRepository().update(runId, (current) => projectV2RunRecordCache(current, initialState, initialEvents));
    return { run, state: initialState };
  }
  if (initialState.lifecycle !== "result_ready" && initialState.lifecycle !== "delivering") {
    throw new Error(`Delivery cannot start while the canonical run is ${initialState.lifecycle}.`);
  }
  await getRunRepository().update(runId, (current) => projectV2RunRecordCache(current, initialState, initialEvents));
  const { run, lease } = await claimRunOperation(runId, "delivery", {
    expectedLifecycles: ["result_ready", "delivering"],
    allowTakeover: true,
    takeoverStaleAfterMs: DEFAULT_STALE_MS
  });
  const abort = createRunAbort(runId, lease.operationId);
  try {
    const coordinator = new RunCoordinator({
      events: store.bind(authority(lease)),
      delivery: { publish: ({ approval: request }) => publishDelivery(run, request, store, abort.signal, lease) },
      clock: () => new Date().toISOString(),
      eventId: eventIdFor(runId)
    });
    const state = await coordinator.execute(runId, { type: "publish_delivery", approval });
    return { run: await cacheProjection(runId, lease, state, store), state };
  } finally {
    disposeRunAbort(runId, lease.operationId);
    await releaseRunOperationWithRetry(runId, lease);
  }
}

async function executeCommand(
  runId: string,
  kind: RunOperationKind,
  expectedLifecycles: readonly RunLifecycle[],
  command: RunCommand
): Promise<{ run: RunRecord; state: RunProjection }> {
  const { run, lease } = await claimRunOperation(runId, kind, { expectedLifecycles });
  try {
    const store = eventStore();
    const state = await coordinatorFor(run, lease, store).execute(runId, command);
    return { run: await cacheProjection(runId, lease, state, store), state };
  } finally {
    await releaseRunOperationWithRetry(runId, lease);
  }
}

/** User control deliberately supersedes an active runner and mints a newer fence. */
async function claimControlOperation(runId: string, _supersededKind: RunOperationKind): Promise<{ run: RunRecord; lease: RunOperationLease }> {
  return claimRunOperation(runId, "control", {
    expectedLifecycles: RUN_STATUS_VALUES,
    allowTakeover: true
  });
}

function coordinatorFor(run: RunRecord, lease: RunOperationLease, store: JsonlRunEventStore): RunCoordinator {
  return new RunCoordinator({
    events: store.bind(authority(lease)),
    delivery: unavailableDelivery,
    clock: () => new Date().toISOString(),
    eventId: eventIdFor(run.runId)
  });
}

async function cacheProjection(
  runId: string,
  lease: RunOperationLease,
  state: RunProjection,
  store: JsonlRunEventStore
): Promise<RunRecord> {
  const events = await store.load(runId);
  await new RunSnapshotStore({ directory: resolveRunsDirectory(), events: store }).write(
    runId,
    authority(lease),
    state,
    state.sequence,
    events.at(-1)!.eventId
  );
  await new EventStoreCompactor(store).compactIfNeeded(runId, authority(lease));
  return updateRunForOperation(runId, lease, (current) => projectV2RunRecordCache(current, state, events));
}

async function publishDelivery(
  run: RunRecord,
  approval: DeliveryApproval,
  store: JsonlRunEventStore,
  operationSignal: AbortSignal,
  lease: RunOperationLease
): Promise<DeliveryReceipt> {
  if (run.targetContext === undefined) throw new Error("Delivery requires the captured run target.");
  const repoRoot = await resolveRunTargetPath(run);
  if (repoRoot === undefined) throw new Error("Delivery requires a local Git target.");
  return withRepositoryLease({ repoRoot, runId: run.runId }, async (_repositoryLease, repositorySignal) => {
    await store.assertAuthority(run.runId, authority(lease));
    return runWithProcessSupervision(
      {
        runId: run.runId,
        operationId: lease.operationId,
        label: "delivery-v2",
        signal: AbortSignal.any([operationSignal, repositorySignal])
      },
      async () => {
        const publisher = new TransactionalDeliveryPublisher({
          validate: async (request) => {
            const state = foldRun(await store.load(run.runId));
            const finalCandidate = state.finalCandidate;
            const manifest = finalCandidate?.finalManifest;
            if (finalCandidate === undefined || manifest === undefined) throw new Error("Delivery requires the complete final artifact manifest.");
            if (manifest.commitSha !== request.finalSha || manifest.deliveryTarget !== request.targetBranch) {
              throw new Error("Delivery approval does not match the durable final artifact manifest.");
            }
            if (manifest.graphRevision !== state.approvedGraphRevision
              || manifest.evidenceMatrixId !== finalCandidate.evidenceMatrixId
              || state.evidenceMatrixSummaries[manifest.evidenceMatrixId]?.validationRecipeDigest !== manifest.validationRecipeDigest
              || manifest.artifactIds.some((artifactId) => !Object.values(state.adoptedArtifacts).some((artifact) => artifact.contract.id === artifactId))) {
              throw new Error("Delivery metadata does not match the canonical graph, evidence, or adopted artifacts.");
            }
            const treeSha = await git(repoRoot, ["rev-parse", `${request.finalSha}^{tree}`]);
            if (treeSha !== manifest.treeSha) throw new Error("The final artifact manifest tree no longer matches the candidate commit.");
          },
          journal: {
            claim: async (_idempotencyKey, requestFingerprint) => {
              const state = foldRun(await store.load(run.runId));
              if (!sameApproval(state.deliveryApproval, approval)) {
                throw new Error("The canonical delivery journal belongs to a different approval.");
              }
              const receipt = state.deliveryReceipt === undefined
                ? undefined
                : transactionalReceipt(state.deliveryReceipt);
              return { requestFingerprint, ...(receipt !== undefined ? { receipt } : {}) };
            },
            complete: async () => undefined
          },
          repository: {
            inspect: async () => ({
              branch: await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
              head: await git(repoRoot, ["rev-parse", "HEAD"]),
              fingerprint: run.targetContext!.fingerprint,
              clean: targetWorkingTreeIsClean(await git(repoRoot, ["status", "--porcelain"]))
            }),
            recover: async (request) => {
              const branch = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
              const head = await git(repoRoot, ["rev-parse", "HEAD"]);
              const clean = targetWorkingTreeIsClean(await git(repoRoot, ["status", "--porcelain"]));
              if (branch !== request.targetBranch || head !== request.finalSha || !clean || request.targetFingerprint !== run.targetContext!.fingerprint) {
                return undefined;
              }
              return deliveryReceipt(request, repoRoot, head);
            },
            publish: async (request) => {
              const branch = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
              const head = await git(repoRoot, ["rev-parse", "HEAD"]);
              const clean = targetWorkingTreeIsClean(await git(repoRoot, ["status", "--porcelain"]));
              if (branch !== request.targetBranch || head !== request.targetHead || !clean || request.targetFingerprint !== run.targetContext!.fingerprint) {
                throw new Error("The delivery target changed immediately before publication; nothing was published.");
              }
              await git(repoRoot, ["merge", "--ff-only", request.finalSha]);
              const deliveredHead = await git(repoRoot, ["rev-parse", "HEAD"]);
              if (deliveredHead !== request.finalSha) throw new Error("Delivery did not publish the approved final SHA.");
              return deliveryReceipt(request, repoRoot, deliveredHead);
            }
          }
        });
        return publisher.publish(approval);
      }
    );
  });
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  return (await supervisedExecFile("git", safeGitArgs(repoRoot, args), { cwd: repoRoot, windowsHide: true })).stdout.trim();
}

function deliveryReceipt(
  approval: TransactionalDeliveryApproval,
  repoRoot: string,
  targetHeadAfter: string
): TransactionalDeliveryReceipt {
  return {
    receiptId: `delivery:${approval.idempotencyKey}`,
    requestFingerprint: deliveryRequestFingerprint(approval),
    manifestId: approval.manifestId,
    finalSha: approval.finalSha,
    targetBranch: approval.targetBranch,
    targetHeadBefore: approval.targetHead,
    targetHeadAfter,
    disposition: "delivered",
    confirmed: true
  };
}

function transactionalReceipt(receipt: DeliveryReceipt): TransactionalDeliveryReceipt {
  if (
    receipt.requestFingerprint === undefined ||
    receipt.finalSha === undefined ||
    receipt.targetBranch === undefined ||
    receipt.targetHeadBefore === undefined ||
    receipt.targetHeadAfter === undefined ||
    receipt.disposition !== "delivered" ||
    receipt.confirmed !== true
  ) {
    throw new Error("The persisted delivery receipt is incomplete.");
  }
  return {
    receiptId: receipt.receiptId,
    requestFingerprint: receipt.requestFingerprint,
    manifestId: receipt.manifestId,
    finalSha: receipt.finalSha,
    targetBranch: receipt.targetBranch,
    targetHeadBefore: receipt.targetHeadBefore,
    targetHeadAfter: receipt.targetHeadAfter,
    disposition: "delivered",
    confirmed: true
  };
}

function sameApproval(left: DeliveryApproval | undefined, right: DeliveryApproval): boolean {
  return left !== undefined &&
    left.manifestId === right.manifestId &&
    left.finalSha === right.finalSha &&
    left.targetBranch === right.targetBranch &&
    left.targetHead === right.targetHead &&
    left.targetFingerprint === right.targetFingerprint &&
    left.actor === right.actor &&
    left.idempotencyKey === right.idempotencyKey;
}

function eventStore(): JsonlRunEventStore {
  return new JsonlRunEventStore({ directory: resolveRunsDirectory() });
}

function authority(lease: RunOperationLease): { operationId: string; fencingToken: number } {
  return { operationId: lease.operationId, fencingToken: lease.fencingToken };
}

function eventIdFor(runId: string): (type: string, sequence: number) => string {
  return (type, sequence) => `${runId}:${type}:${sequence}`;
}

const unavailableDelivery = {
  publish: async (): Promise<never> => {
    throw new Error("Delivery is not available for this command.");
  }
};
