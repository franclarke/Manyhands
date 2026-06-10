import {
  RunLifecycleError,
  assertTransition,
  getRunRepository,
  parseRunPatches,
} from "@/lib/server/runs";
import type { RunRecord } from "@/lib/server/runs/schema";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import { hasPlanningCheckpoint } from "./planning-host";
import { resumePlanningPipeline } from "./planning-pipeline";

export async function processPlanApproval(id: string, acknowledge: boolean): Promise<RunRecord> {
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

  assertTransition(run.status, "approved");

  // Native path: the approval is a Command({ resume }) into the suspended
  // approvalGate; the pipeline projects END(status=approved) onto the record.
  if (await hasPlanningCheckpoint(id)) {
    await resumePlanningPipeline(id, { action: "approve" });
    return repo.get(id);
  }

  // Legacy runs without a planning thread: direct transition.
  const now = new Date().toISOString();
  const saved = await repo.save({ ...run, status: "approved", approvedAt: now });
  publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: now });
  return saved;
}
