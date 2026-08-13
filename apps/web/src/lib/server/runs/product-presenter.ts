import type { RunPreview, RunResponse, StageSelection, Workspace } from "@/lib/api-types";
import type { ProductRunDefinition, RunProjection } from "@manyhands/run-coordinator";

function stage(selection: ProductRunDefinition["planningSelection"]): StageSelection {
  return {
    executorId: selection.executorId as StageSelection["executorId"],
    model: selection.model,
    ...(selection.effort === undefined
      ? {}
      : { effort: selection.effort as NonNullable<StageSelection["effort"]> })
  };
}

export function toProductRunResponse(
  projection: RunProjection,
  canonicalWorkspaceId = requireDefinition(projection).workspaceId
): RunResponse {
  const definition = requireDefinition(projection);
  return {
    run: {
      runId: projection.runId,
      workspaceId: canonicalWorkspaceId,
      userPrompt: definition.userPrompt,
      title: projection.title ?? definition.title,
      lifecycle: projection.lifecycle,
      eventSequence: projection.sequence,
      planningSelection: stage(definition.planningSelection),
      executionSelection: stage(definition.executionSelection),
      repairSelection: stage(definition.repairSelection),
      version: projection.sequence,
      createdAt: projection.createdAt,
      updatedAt: projection.updatedAt,
      ...(projection.graphId === undefined ? {} : { graphId: projection.graphId }),
      ...(projection.graphRevision === undefined ? {} : { graphRevision: projection.graphRevision }),
      ...(projection.approvedGraphRevision === undefined ? {} : { approvedGraphRevision: projection.approvedGraphRevision }),
      ...(projection.finalCandidate?.manifestId === undefined
        ? {}
        : { finalManifestId: projection.finalCandidate.manifestId }),
      ...(projection.finalCandidate?.commit === undefined
        ? {}
        : { finalCommit: projection.finalCandidate.commit }),
      ...(projection.failureReason === undefined ? {} : { failureReason: projection.failureReason })
    }
  };
}

export function toProductRunPreview(
  projection: RunProjection,
  workspaces: ReadonlyMap<string, Workspace>
): RunPreview {
  const definition = requireDefinition(projection);
  const workspace = workspaces.get(definition.workspaceId);
  return {
    id: projection.runId,
    workspaceId: workspace?.id ?? definition.workspaceId,
    ...(workspace === undefined ? {} : { workspaceName: workspace.name }),
    title: projection.title ?? definition.title,
    userPrompt: definition.userPrompt,
    status: projection.lifecycle,
    createdAt: projection.createdAt,
    updatedAt: projection.updatedAt,
    href: `/runs/${projection.runId}`
  };
}

function requireDefinition(projection: RunProjection): ProductRunDefinition {
  if (projection.definition === undefined) {
    throw new Error(`Run ${projection.runId} has no productive definition.`);
  }
  return projection.definition;
}
