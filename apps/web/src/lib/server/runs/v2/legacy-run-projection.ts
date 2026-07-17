import type { RunEvent, RunProjection } from "@manyhands/run-coordinator";
import type { RunRecord } from "../schema";

/** Compatibility DTO only. Canonical semantics remain in the V2 event log. */
export function projectPlanningV2ToRunRecord(run: RunRecord, state: RunProjection, events: readonly RunEvent[]): RunRecord {
  const compiled = [...events].reverse().find((event) => event.type === "graph.compiled");
  const repository = [...events].reverse().find((event) => event.type === "repository.inspected");
  const now = new Date().toISOString();
  return {
    ...run,
    architectureVersion: { planning: "v2", execution: run.architectureVersion?.execution ?? "v1", integration: run.architectureVersion?.integration ?? "v1" },
    status: state.lifecycle === "failed" ? "failed" : state.lifecycle === "running" ? "approved" : "needs_review",
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
