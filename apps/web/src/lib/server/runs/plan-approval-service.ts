import { RunLifecycleError, parseRunPatches } from "@/lib/server/runs";
import type { RunRecord } from "@/lib/server/runs/schema";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import { getRunRepository } from "./store";
import { claimRunMutation } from "./mutation-guard";
import { hasPlanningCheckpoint } from "./planning-host";
import { resumePlanningPipeline } from "./planning-pipeline";

export async function processPlanApproval(
  id: string,
  acknowledge: boolean,
  expectedVersion?: number
): Promise<RunRecord> {
  const repo = getRunRepository();
  const run = await repo.get(id);

  // Quality gate (Fase B): block approval on reliable critic errors — graph
  // validation errors + orphan consumed seams — unless the user explicitly
  // acknowledged them in the plan review gate. Recomputed from the snapshot so
  // it matches what the modal shows (and reflects post-planning edits).
  if (!acknowledge) {
    const summary = buildPlanReviewSummary(projectRunRecordToSnapshot(run), parseRunPatches(run.patches));
    if (summary !== null && summary.issueCounts.errors > 0) {
      const detail = summary.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.title)
        .join(", ");
      throw new RunLifecycleError(
        `Plan has ${summary.issueCounts.errors} blocking error(s): ${detail}. ` +
          "Resolve them, or approve explicitly from the plan review gate."
      );
    }
  }

  // Claim the approval atomically (INV-4) BEFORE resuming the planning graph:
  // the mutator moves the run to "approved", so a concurrent duplicate approval
  // finds no approvable status and gets a deterministic 409 — exactly one
  // caller ever delivers Command({ resume }) into the approvalGate.
  const now = new Date().toISOString();
  const claimed = await claimRunMutation(
    id,
    {
      // Mirrors the lifecycle transitions into "approved": the review gate plus
      // the re-open paths (re-run a node after a finished run).
      status: ["needs_review", "completed", "failed"],
      ...(expectedVersion !== undefined ? { version: expectedVersion } : {})
    },
    (current) => ({ ...current, status: "approved" as const, approvedAt: current.approvedAt ?? now })
  );
  publishRunEvent(claimed.runId, { kind: "status.changed", status: claimed.status, at: now });

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
