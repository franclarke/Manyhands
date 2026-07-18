import type { RunEvent, RunProjection } from "@manyhands/run-coordinator";
import type { RunRecord } from "../schema";

/** Materialize a disposable list/header cache after canonical events commit. */
export function projectV2RunRecordCache(
  run: RunRecord,
  state: RunProjection,
  events: readonly RunEvent[]
): RunRecord {
  const repository = [...events].reverse().find((event) => event.type === "repository.inspected");
  const now = new Date().toISOString();
  return {
    ...run,
    projection: {
      eventSequence: state.sequence,
      lifecycle: state.lifecycle,
      ...(state.graphId !== undefined ? { graphId: state.graphId } : {}),
      ...(state.graphRevision !== undefined ? { graphRevision: state.graphRevision } : {}),
      ...(state.approvedGraphRevision !== undefined ? { approvedGraphRevision: state.approvedGraphRevision } : {}),
      ...(repository?.type === "repository.inspected" ? { repositorySnapshotId: repository.payload.snapshotId } : {}),
      ...(state.finalCandidate !== undefined ? { finalManifestId: state.finalCandidate.manifestId, finalCommit: state.finalCandidate.commit } : {}),
      ...(state.failureReason !== undefined ? { failureReason: state.failureReason } : {}),
      updatedAt: now
    },
    updatedAt: now
  };
}
