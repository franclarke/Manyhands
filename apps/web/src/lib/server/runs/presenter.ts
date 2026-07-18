import type { RunPreview, RunResponse, StageSelection, Workspace } from "@/lib/api-types";
import { getWorkspaceRepository, WorkspaceNotFoundError } from "@/lib/server/workspaces";

import type { RunRecord } from "./schema";

function toStagePayload(selection: RunRecord["executionSelection"]): StageSelection {
  return {
    executorId: selection.executorId,
    model: selection.model,
    ...(selection.effort !== undefined ? { effort: selection.effort } : {})
  };
}

export function toRunResponse(run: RunRecord, canonicalWorkspaceId = run.workspaceId): RunResponse {
  return {
    run: {
      runId: run.runId,
      workspaceId: canonicalWorkspaceId,
      userPrompt: run.userPrompt,
      title: run.title,
      lifecycle: run.projection.lifecycle,
      eventSequence: run.projection.eventSequence,
      planningSelection: toStagePayload(run.planningSelection),
      executionSelection: toStagePayload(run.executionSelection),
      repairSelection: toStagePayload(run.repairSelection),
      version: run.version,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      ...(run.projection.graphId !== undefined ? { graphId: run.projection.graphId } : {}),
      ...(run.projection.graphRevision !== undefined ? { graphRevision: run.projection.graphRevision } : {}),
      ...(run.projection.approvedGraphRevision !== undefined ? { approvedGraphRevision: run.projection.approvedGraphRevision } : {}),
      ...(run.projection.finalManifestId !== undefined ? { finalManifestId: run.projection.finalManifestId } : {}),
      ...(run.projection.finalCommit !== undefined ? { finalCommit: run.projection.finalCommit } : {}),
      ...(run.projection.failureReason !== undefined ? { failureReason: run.projection.failureReason } : {})
    }
  };
}

export async function toCanonicalRunResponse(run: RunRecord): Promise<RunResponse> {
  try {
    const workspace = await getWorkspaceRepository().get(run.workspaceId);
    return toRunResponse(run, workspace.id);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) return toRunResponse(run);
    throw error;
  }
}

export function toRunPreview(run: RunRecord, workspaces: ReadonlyMap<string, Workspace>): RunPreview {
  const workspace = workspaces.get(run.workspaceId);
  return {
    id: run.runId,
    workspaceId: workspace?.id ?? run.workspaceId,
    ...(workspace !== undefined ? { workspaceName: workspace.name } : {}),
    title: run.title,
    userPrompt: run.userPrompt,
    status: run.projection.lifecycle,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    href: `/runs/${run.runId}`
  };
}
