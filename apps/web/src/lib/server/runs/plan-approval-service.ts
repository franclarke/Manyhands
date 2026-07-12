import { RunLifecycleError, parseRunPatches } from "@/lib/server/runs";
import type { RunRecord } from "@/lib/server/runs/schema";
import { appendRunEventRequired } from "@/lib/server/runs/run-model-event-log";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import { getRunRepository } from "./store";
import { claimRunMutation } from "./mutation-guard";
import { hasPlanningCheckpoint } from "./planning-host";
import { resumePlanningPipeline } from "./planning-pipeline";
import { appendStatusEventOrRollback, requireCapturedRunRecord } from "./audited-mutation";
import { assertExecutableRunGraph, resolveExecutionGraph } from "./execution-state";
import { approvalDecisionId } from "./editing";

export interface PlanApprovalOptions {
  expectedVersion?: number;
  criticOverride?: {
    actor: string;
    acknowledgedErrors: string[];
  };
}

export async function processPlanApproval(
  id: string,
  options: PlanApprovalOptions = {}
): Promise<RunRecord> {
  const repo = getRunRepository();
  const run = await repo.get(id);
  assertExecutableRunGraph(resolveExecutionGraph(run));

  // Quality gate (Fase B): block approval on reliable critic errors — graph
  // validation errors + orphan consumed seams — unless the user explicitly
  // acknowledged them in the plan review gate. Recomputed from the snapshot so
  // it matches what the modal shows (and reflects post-planning edits).
  const summary = buildPlanReviewSummary(projectRunRecordToSnapshot(run), parseRunPatches(run.patches));
  const reviewErrors = summary?.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.title) ?? [];
  const persistedCriticErrors = [
    ...(run.planningCritic?.findings ?? []),
    ...(run.seamCritic?.findings ?? [])
  ].filter((finding) => finding.severity === "error").map((finding) => finding.message);
  const criticErrors = [...new Set([...reviewErrors, ...persistedCriticErrors])];
  if (criticErrors.length > 0) {
    const acknowledged = options.criticOverride?.acknowledgedErrors ?? [];
    const completeOverride = criticErrors.every((error) => acknowledged.includes(error));
    if (!completeOverride) {
      const detail = criticErrors.join(", ");
      throw new RunLifecycleError(
        `Plan has ${criticErrors.length} blocking error(s): ${detail}. ` +
          "Resolve them, or use an explicit critic override acknowledging every error."
      );
    }
  }

  // Claim the approval atomically (INV-4) BEFORE resuming the planning graph:
  // the mutator moves the run to "approved", so a concurrent duplicate approval
  // finds no approvable status and gets a deterministic 409 — exactly one
  // caller ever delivers Command({ resume }) into the approvalGate.
  const now = new Date().toISOString();
  let previous: RunRecord | undefined;
  const claimed = await claimRunMutation(
    id,
    {
      // Mirrors the lifecycle transitions into "approved": the review gate plus
      // the re-open paths (re-run a node after a finished run).
      status: ["needs_review", "completed", "failed"],
      ...(options.expectedVersion !== undefined ? { version: options.expectedVersion } : {})
    },
    (current) => {
      previous = current;
      return {
        ...current,
        status: "approved" as const,
        approvedAt: now,
        approvedPlanRevision: current.planRevision ?? 1,
        ...(criticErrors.length > 0 && options.criticOverride !== undefined
          ? {
              planApprovalOverride: {
                revision: current.planRevision ?? 1,
                actor: options.criticOverride.actor,
                acknowledgedErrors: criticErrors,
                at: now
              }
            }
          : {})
      };
    }
  );
  await appendStatusEventOrRollback(requireCapturedRunRecord(previous, id), claimed, { at: now, actor: "human" });
  await appendRunEventRequired(claimed.runId, {
    actor: "human",
    at: now,
    type: "decision.resolved",
    payload: {
      decisionId: approvalDecisionId(claimed.planRevision),
      choice: { action: "approve" },
      actor: "human"
    }
  });

  // Native path: deliver the approval as Command({ resume }) into the suspended
  // approvalGate; the pipeline re-projects END(status=approved) onto the record
  // (idempotent over the claim above). Legacy runs without a planning thread
  // already hold the final state from the claim.
  if (await hasPlanningCheckpoint(id)) {
    await resumePlanningPipeline(id, { action: "approve" });
    return repo.get(id);
  }
  return claimed;
}
