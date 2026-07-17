import { createHash, randomUUID } from "node:crypto";
import {
  computeGranularityVector,
  computeSeamInvalidationClosure,
  filterInvalidatedResults,
  type RunExecutionResult
} from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";
import type { Amendment, Seam } from "@/lib/run-model/types";
import { RunLifecycleError, RunMutationConflictError, RunValidationError } from "./errors";
import {
  assertExecutableRunGraph,
  executionResultsFromRun,
  integrationDurationMs,
  provisionedFromRecord,
  resolveExecutionGraph
} from "./execution-state";
import { isRunnerActive } from "./runner-state";
import { JsonPlanMutationJournal, type PlanMutationOperation } from "./plan-mutation-journal";
import { appendPatch, type RunPatch } from "./patches";
import { resolveRunsDirectory } from "./repository";
import { assertPendingDecisionRequired } from "./run-model-event-log";
import { claimRunOperation, releaseRunOperation, updateRunForOperation } from "./run-operation-lease";
import { startHeartbeat } from "./runner-heartbeat";
import type { RunRecord } from "./schema";
import { getRunRepository } from "./store";
import {
  finalizePersistedAmendment,
  type AmendmentFinalizationDeps
} from "./plan-mutation-recovery";

export interface ApproveAmendmentInput {
  run: RunRecord;
  decisionId: string;
  amendment: Amendment;
  seam: Seam | undefined;
  expectedVersion?: number;
  at: string;
}

export interface ApproveAmendmentDeps extends AmendmentFinalizationDeps {
  afterRunRecordCas?: () => Promise<void> | void;
  afterRecordPersisted?: () => Promise<void> | void;
}

/**
 * Apply an approved seam amendment as one fenced, durable plan mutation.
 *
 * The event-log facts deliberately come last: until the amended graph has won
 * the RunRecord CAS and the obsolete execution checkpoint is gone, the human
 * gate remains pending and retryable.  A 2xx therefore always implies that the
 * graph/contract patch and its new plan revision are durable.
 */
export async function approveAmendment(
  input: ApproveAmendmentInput,
  deps: ApproveAmendmentDeps = {}
): Promise<RunRecord> {
  const { amendment } = input;
  if (amendment.kind !== "seam") {
    throw new RunValidationError(`Amendment ${amendment.id} has unsupported kind "${amendment.kind}".`);
  }
  if (isRunnerActive(input.run.runId)) {
    throw new RunLifecycleError(`Run ${input.run.runId} is being driven by an active runner.`);
  }
  const provisioned = provisionedFromRecord(input.run.provisioned);
  if (provisioned === undefined) {
    throw new RunLifecycleError(`Run ${input.run.runId} has no provisioned repository for amendment invalidation.`);
  }

  const patch = amendmentPatch(input);
  const candidate = appendPatch(input.run, patch);
  let amendedGraph: TaskGraph;
  try {
    amendedGraph = resolveExecutionGraph(candidate);
    assertExecutableRunGraph(amendedGraph);
  } catch (error) {
    throw new RunValidationError(
      `Amendment ${amendment.id} does not produce a valid durable graph: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const sourcePlanRevision = input.run.planRevision ?? 1;
  const targetPlanRevision = sourcePlanRevision + 1;
  const journalOperationId =
    `amendment:${input.run.runId}:${amendment.id}:r${sourcePlanRevision}-r${targetPlanRevision}:${randomUUID()}`;
  const claimed = await claimRunOperation(input.run.runId, "replan", {
    expectedStatuses: ["running"],
    expectedVersion: input.expectedVersion ?? input.run.version,
    operationId: randomUUID(),
    allowTakeover: false
  });
  const lease = claimed.lease;
  const stopHeartbeat = startHeartbeat(input.run.runId, lease);
  const journal = new JsonPlanMutationJournal({ directory: `${resolveRunsDirectory()}/plan-mutations` });
  let operation: PlanMutationOperation | undefined;
  let recordPersisted = false;

  try {
    // The persisted operation claim serializes approve vs reject. Re-check the
    // event-log gate only after owning it and before any physical side effect.
    await assertPendingDecisionRequired(claimed.run, input.decisionId);

    const existing = executionResultsFromRun(input.run);
    const invalidatedTaskIds = patch.changeKind === "signature"
      ? computeSeamInvalidationClosure(amendedGraph, patch.seamId)
      : new Set<string>();
    const surviving = filterInvalidatedResults(
      existing.leafResults,
      existing.integrationResults,
      invalidatedTaskIds
    );
    const totalDurationMs =
      surviving.leafResults.reduce((sum, result) => sum + result.executorDurationMs, 0) +
      surviving.integrationResults.reduce((sum, result) => sum + integrationDurationMs(result), 0);
    const updatedExecution: RunExecutionResult = {
      runId: input.run.runId,
      status: "failed",
      leafResults: surviving.leafResults,
      integrationResults: surviving.integrationResults,
      totalDurationMs,
      granularityVector: computeGranularityVector({
        graph: amendedGraph,
        leafResults: surviving.leafResults,
        integrationResults: surviving.integrationResults,
        totalDurationMs
      })
    };

    operation = await journal.reserve({
      operationId: journalOperationId,
      runId: input.run.runId,
      kind: "amendment",
      expectedRunVersion: input.run.version,
      sourcePlanRevision,
      targetPlanRevision,
      ...(input.run.targetContext?.fingerprint !== undefined
        ? { targetFingerprint: input.run.targetContext.fingerprint }
        : {}),
      graphHash: createHash("sha256").update(JSON.stringify(amendedGraph)).digest("hex"),
      preparedGraph: amendedGraph,
      patchId: patch.id,
      amendmentId: amendment.id,
      decisionId: input.decisionId,
      runOperationId: lease.operationId,
      invalidatedTaskIds: [...invalidatedTaskIds]
    });
    operation = await journal.transition(operation.operationId, {
      expectedVersion: operation.version,
      status: "graph_prepared"
    });

    const persisted = await updateRunForOperation(input.run.runId, lease, (current) => {
      if (current.status !== "running" || (current.planRevision ?? 1) !== sourcePlanRevision) {
        throw new RunMutationConflictError(
          `Amendment ${amendment.id} was prepared for a stale plan revision.`,
          current.status,
          current.version
        );
      }
      if ((current.patches ?? []).some((entry) => patchIdentity(entry) === patch.id)) {
        throw new RunMutationConflictError(
          `Amendment ${amendment.id} is already present in the durable patch log.`,
          current.status,
          current.version
        );
      }
      const next: RunRecord = {
        ...appendPatch(current, patch),
        execution: updatedExecution,
        planRevision: targetPlanRevision,
        status: "needs_review"
      };
      delete next.approvedAt;
      delete next.approvedPlanRevision;
      delete next.planApprovalOverride;
      return next;
    });
    recordPersisted = true;
    assertDurableAmendment(persisted, patch);
    await deps.afterRunRecordCas?.();
    operation = await journal.transition(operation.operationId, {
      expectedVersion: operation.version,
      status: "record_persisted"
    });
    await deps.afterRecordPersisted?.();
    operation = await finalizePersistedAmendment({
      run: persisted,
      operation,
      lease,
      patch,
      amendment,
      decisionId: input.decisionId,
      at: input.at,
      deps
    });
  } catch (error) {
    if (!recordPersisted && operation !== undefined && operation.status !== "failed" && operation.status !== "completed") {
      await journal.transition(operation.operationId, {
        expectedVersion: operation.version,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    stopHeartbeat();
    await releaseRunOperation(input.run.runId, lease).catch(() => undefined);
  }
  return getRunRepository().get(input.run.runId);
}

function amendmentPatch(input: ApproveAmendmentInput): Extract<RunPatch, { type: "SEAM_AMENDED" }> {
  const { amendment, seam } = input;
  const seamId = amendment.detail.seamId;
  const fromRevision = amendment.detail.fromRevision;
  const toRevision = amendment.detail.toRevision;
  if (seamId === undefined || fromRevision === undefined || toRevision === undefined) {
    throw new RunValidationError(`Amendment ${amendment.id} must identify its seam and exact revision transition.`);
  }
  if (seam === undefined || seam.id !== seamId) {
    throw new RunValidationError(`Amendment ${amendment.id} refers to unknown seam ${seamId}.`);
  }
  if (seam.revision !== fromRevision || toRevision !== fromRevision + 1) {
    throw new RunValidationError(
      `Amendment ${amendment.id} is stale: seam ${seamId} is r${seam.revision}, not r${fromRevision} -> r${toRevision}.`
    );
  }
  if (amendment.changeKind === "signature" && amendment.detail.newSignature === undefined) {
    throw new RunValidationError(`Signature amendment ${amendment.id} has no new signature.`);
  }
  if (amendment.changeKind === "contract" && amendment.detail.contract === undefined) {
    throw new RunValidationError(`Contract amendment ${amendment.id} has no semantic contract facts.`);
  }
  return {
    id: `amendment-${amendment.id}-r${fromRevision}-r${toRevision}`,
    createdAt: input.at,
    actor: "human",
    type: "SEAM_AMENDED",
    amendmentId: amendment.id,
    decisionId: input.decisionId,
    nodeId: amendment.nodeId,
    affects: [...amendment.affects],
    seamId,
    fromRevision,
    toRevision,
    changeKind: amendment.changeKind,
    ...(amendment.detail.newSignature !== undefined ? { signature: amendment.detail.newSignature } : {}),
    ...(amendment.detail.contract !== undefined ? { contract: amendment.detail.contract } : {})
  };
}

function patchIdentity(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : undefined;
}

function assertDurableAmendment(
  run: RunRecord,
  patch: Extract<RunPatch, { type: "SEAM_AMENDED" }>
): void {
  if (!(run.patches ?? []).some((entry) => patchIdentity(entry) === patch.id)) {
    throw new RunLifecycleError(`Run ${run.runId} did not persist amendment patch ${patch.id}.`);
  }
  const graph = resolveExecutionGraph(run);
  const copies = Object.values(graph.nodes).flatMap((node) => [
    ...(node.contract?.producedInterfaces ?? []),
    ...(node.contract?.consumedInterfaces ?? [])
  ]).filter((iface) => iface.id === patch.seamId);
  if (copies.length === 0) {
    throw new RunLifecycleError(`Run ${run.runId} lost seam ${patch.seamId} while persisting the amendment.`);
  }
  for (const iface of copies) {
    if (patch.signature !== undefined && iface.signature !== patch.signature) {
      throw new RunLifecycleError(`Run ${run.runId} did not persist the amended signature on every ${patch.seamId} contract.`);
    }
    for (const [key, value] of Object.entries(patch.contract ?? {})) {
      if (iface.contract?.[key] !== value) {
        throw new RunLifecycleError(`Run ${run.runId} did not persist ${patch.seamId} contract fact ${key}.`);
      }
    }
  }
}
