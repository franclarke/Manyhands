import type { Amendment, RunEventPayloads } from "@/lib/run-model/types";
import type { PlanGraphProjectedPayload } from "@/lib/run-model/types";
import type { RunModelEventInput } from "./run-model-event-log";
import type { RunPatch } from "./patches";
import type { RunRecord } from "./schema";
import { approvalDecisionId } from "./decision-identity";
import { runControlForRun } from "./run-model-projection";

export type SeamAmendmentPatch = Extract<RunPatch, { type: "SEAM_AMENDED" }>;

export interface DurableAmendmentEventInput {
  run: RunRecord;
  patch: SeamAmendmentPatch;
  amendment: Amendment;
  decisionId: string;
  graphProjection: PlanGraphProjectedPayload;
  at: string;
}

/** Stable identities shared by the direct path and crash recovery. */
export function amendmentEventIds(
  runId: string,
  patch: SeamAmendmentPatch,
  amendmentId: string,
  decisionId: string,
  planRevision: number
) {
  return {
    statusChanged: `amendment-status:${runId}:${patch.id}:r${planRevision}`,
    graphProjected: `amendment-plan-graph:${runId}:${patch.id}:r${planRevision}`,
    amendmentProposed: `amendment-materialized:${runId}:${amendmentId}:r${planRevision}`,
    seamAmended: `seam-amended:${runId}:${amendmentId}:r${patch.toRevision}`,
    amendmentApplied: `amendment-applied:${runId}:${amendmentId}:r${planRevision}`,
    decisionResolved: `amendment-decision:${runId}:${decisionId}:r${planRevision}`,
    approvalRaised: `amendment-approval:${runId}:${amendmentId}:r${planRevision}`
  } as const;
}

/**
 * One atomic event batch for the durable amendment boundary. Materialization
 * facts precede gate resolution, so even incremental bus consumers never see a
 * resolved human gate over an unapplied seam.
 */
export function buildDurableAmendmentEvents(
  input: DurableAmendmentEventInput
): RunModelEventInput[] {
  const { run, patch, amendment, decisionId, graphProjection, at } = input;
  const planRevision = run.planRevision ?? 1;
  const ids = amendmentEventIds(run.runId, patch, amendment.id, decisionId, planRevision);
  const amendmentPayload: RunEventPayloads["amendment.proposed"] = {
    amendmentId: amendment.id,
    nodeId: amendment.nodeId,
    kind: amendment.kind,
    changeKind: amendment.changeKind,
    detail: structuredClone(amendment.detail),
    affects: [...amendment.affects]
  };
  return [
    {
      eventId: ids.statusChanged,
      actor: "system",
      at,
      type: "run.status.changed",
      payload: runControlForRun(run)
    },
    {
      eventId: ids.graphProjected,
      actor: "system",
      at,
      type: "plan.graph.projected",
      payload: graphProjection
    },
    {
      eventId: ids.amendmentProposed,
      actor: "system",
      at,
      type: "amendment.proposed",
      payload: amendmentPayload
    },
    {
      eventId: ids.seamAmended,
      actor: "system",
      at,
      type: "seam.amended",
      payload: {
        seamId: patch.seamId,
        revision: patch.toRevision,
        changeKind: patch.changeKind,
        ...(patch.signature !== undefined ? { signature: patch.signature } : {}),
        ...(patch.contract !== undefined ? { contract: patch.contract } : {})
      }
    },
    {
      eventId: ids.amendmentApplied,
      actor: "system",
      at,
      type: "amendment.applied",
      payload: { amendmentId: amendment.id }
    },
    {
      eventId: ids.decisionResolved,
      actor: "human",
      at,
      type: "decision.resolved",
      payload: {
        decisionId,
        choice: { action: "approve" },
        actor: "human"
      }
    },
    {
      eventId: ids.approvalRaised,
      actor: "system",
      at,
      type: "decision.raised",
      payload: {
        decisionId: approvalDecisionId(planRevision),
        kind: "approve_plan",
        blocking: true,
        context: {
          nodeIds: graphProjection.nodes
            .filter((node) => node.role === "leaf")
            .map((node) => node.nodeId)
        }
      }
    }
  ];
}
