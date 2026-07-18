import { randomUUID } from "node:crypto";

import { safeGitArgs } from "@manyhands/execution-core";
import {
  RunCoordinator,
  foldRun,
  type DeliveryApproval,
  type DeliveryReceipt,
  type RunCommand,
  type RunLifecycle,
  type RunProjection
} from "@manyhands/run-coordinator";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";

import { getRunRepository } from "../store";
import { runWithProcessSupervision, supervisedExecFile } from "../process-supervision";
import { withRepositoryLease } from "../repo-lock";
import { abortRun } from "../run-abort-registry";
import { killRunProcessesVerified, type KillRunProcessesDeps } from "../process-evidence";
import {
  claimRunOperation,
  releaseRunOperationWithRetry,
  updateRunForOperation
} from "../run-operation-lease";
import { resolveRunsDirectory } from "../runs-directory";
import type { RunOperationKind, RunOperationLease, RunRecord } from "../schema";
import { resolveRunTargetPath } from "../target-context";
import { projectV2RunRecordCache } from "./run-record-cache";

export interface CancellationResultV2 {
  run: RunRecord;
  state: RunProjection;
  allProcessesDead: boolean;
  processCount: number;
}

export async function loadRunProjectionV2(runId: string): Promise<RunProjection> {
  return foldRun(await eventStore().load(runId));
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
  const result = await executeCommand(runId, "control", ["waiting_for_input", "running"], {
    type: "resolve_decision",
    decisionId,
    ...resolution
  });
  if (resolution.optionId === "stop") {
    return executeCommand(runId, "control", [result.state.lifecycle], {
      type: "fail",
      reason: `The operator stopped the branch affected by decision ${decisionId}.`,
      area: "execution"
    });
  }
  return result;
}

export async function pauseRunV2(runId: string, reason: string): Promise<{ run: RunRecord; state: RunProjection; allProcessesDead: boolean }> {
  const { run, lease } = await claimControlOperation(runId, "execution");
  let allProcessesDead = true;
  try {
    const store = eventStore();
    await store.advanceFence(runId, authority(lease));
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
    await store.advanceFence(runId, authority(lease));
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
  const { run, lease } = await claimRunOperation(runId, "delivery", {
    expectedLifecycles: ["result_ready"],
    allowTakeover: true
  });
  try {
    const store = eventStore();
    await store.advanceFence(runId, authority(lease));
    const coordinator = new RunCoordinator({
      events: store.bind(authority(lease)),
      delivery: { publish: ({ approval: request }) => publishDelivery(run, request) },
      clock: () => new Date().toISOString(),
      eventId: eventIdFor(runId)
    });
    const state = await coordinator.execute(runId, { type: "publish_delivery", approval });
    return { run: await cacheProjection(runId, lease, state, store), state };
  } finally {
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
    await store.advanceFence(runId, authority(lease));
    const state = await coordinatorFor(run, lease, store).execute(runId, command);
    return { run: await cacheProjection(runId, lease, state, store), state };
  } finally {
    await releaseRunOperationWithRetry(runId, lease);
  }
}

/** User control deliberately supersedes an active runner and mints a newer fence. */
async function claimControlOperation(runId: string, _supersededKind: RunOperationKind): Promise<{ run: RunRecord; lease: RunOperationLease }> {
  let lease: RunOperationLease | undefined;
  const run = await getRunRepository().update(runId, (current) => {
    const now = new Date().toISOString();
    lease = {
      operationId: randomUUID(),
      kind: "control",
      fencingToken: Math.max(current.mutationFence ?? 0, current.activeOperation?.fencingToken ?? 0) + 1,
      acquiredAt: now,
      heartbeatAt: now
    };
    return { ...current, mutationFence: lease.fencingToken, activeOperation: lease, heartbeatAt: now };
  });
  return { run, lease: lease! };
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
  return updateRunForOperation(runId, lease, (current) => projectV2RunRecordCache(current, state, events));
}

async function publishDelivery(run: RunRecord, approval: DeliveryApproval): Promise<DeliveryReceipt> {
  if (run.targetContext === undefined) throw new Error("Delivery requires the captured run target.");
  const repoRoot = await resolveRunTargetPath(run);
  if (repoRoot === undefined) throw new Error("Delivery requires a local Git target.");
  return withRepositoryLease({ repoRoot, runId: run.runId }, () => runWithProcessSupervision(
    { runId: run.runId, label: "delivery-v2" },
    async () => {
      const branch = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const head = await git(repoRoot, ["rev-parse", "HEAD"]);
      if (approval.targetFingerprint !== run.targetContext!.fingerprint) throw new Error("Delivery target fingerprint changed.");
      if (branch !== approval.targetBranch || head !== approval.targetHead) {
        throw new Error(`Delivery target changed; expected ${approval.targetBranch}@${approval.targetHead}, found ${branch}@${head}.`);
      }
      if ((await git(repoRoot, ["status", "--porcelain"])).trim().length > 0) throw new Error("Delivery requires a clean target working tree.");
      const alreadyDelivered = await isAncestor(repoRoot, approval.finalSha, "HEAD");
      if (!alreadyDelivered) await git(repoRoot, ["merge", "--ff-only", approval.finalSha]);
      const deliveredHead = await git(repoRoot, ["rev-parse", "HEAD"]);
      if (deliveredHead !== approval.finalSha) throw new Error("Delivery did not publish the approved final SHA.");
      return {
        receiptId: `delivery:${approval.idempotencyKey}`,
        requestFingerprint: approval.idempotencyKey,
        manifestId: approval.manifestId,
        finalSha: approval.finalSha,
        targetBranch: branch,
        targetHeadBefore: head,
        targetHeadAfter: deliveredHead,
        disposition: "delivered",
        destination: `${repoRoot}#${branch}`,
        confirmed: true
      };
    }
  ));
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  return (await supervisedExecFile("git", safeGitArgs(repoRoot, args), { cwd: repoRoot, windowsHide: true })).stdout.trim();
}

async function isAncestor(repoRoot: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await git(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
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
