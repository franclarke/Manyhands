import type { RunEvent, RunProjection } from "@manyhands/run-coordinator";
import type { RunRecord } from "../schema";

/** Disposable compatibility cache only. Canonical semantics remain in the V2 event log. */
export function projectPlanningV2ToRunRecord(run: RunRecord, state: RunProjection, events: readonly RunEvent[]): RunRecord {
  const compiled = [...events].reverse().find((event) => event.type === "graph.compiled");
  const repository = [...events].reverse().find((event) => event.type === "repository.inspected");
  const now = new Date().toISOString();
  return {
    ...run,
    architectureVersion: { planning: "v2", execution: "v2", integration: "v2" },
    status: compatibilityStatus(state),
    ...(state.lifecycle === "failed" ? { failedDuring: "generating" as const, errorMessage: state.failureReason ?? "Planning V2 failed." } : {}),
    planning: {
      architectureVersion: "v2",
      eventSequence: state.sequence,
      repositorySnapshotId: repository?.type === "repository.inspected" ? repository.payload.snapshotId : undefined,
      graphId: state.graphId,
      graphRevision: state.graphRevision,
      compiledPlan: compiled?.type === "graph.compiled" ? compiled.payload : undefined
    },
    planRevision: state.graphRevision ?? run.planRevision,
    ...(state.lifecycle === "running" && state.approvedGraphRevision !== undefined ? { approvedPlanRevision: state.approvedGraphRevision, approvedAt: now } : {}),
    updatedAt: now
  };
}

function compatibilityStatus(state: RunProjection): RunRecord["status"] {
  switch (state.lifecycle) {
    case "planning":
      return "generating";
    case "needs_approval":
      return "needs_review";
    case "running":
      return "approved";
    case "waiting_for_input":
    case "paused":
      return "paused";
    case "cancelling":
      return "cancelling";
    case "interrupted":
      return "interrupted";
    case "result_ready":
      return "needs_delivery";
    case "delivering":
      return "needs_delivery";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}
