import { createHash } from "node:crypto";
import {
  reviseLegacyGraphRevisionV2,
  type LegacyArtifactRequirementV2,
  type LegacyGraphRevisionV2,
  type LegacyGraphRevisionV2Operation
} from "@manyhands/task-graph";

export interface GraphAmendmentProposal {
  proposalId: string;
  graphId: string;
  sourceRevision: number;
  kind: "artifact_requirement" | "graph_revision";
  rationale: string;
  evidenceRefs: string[];
  operations: LegacyGraphRevisionV2Operation[];
}

export function proposeDiscoveredArtifactRequirement(input: {
  graph: LegacyGraphRevisionV2;
  producerNodeId: string;
  consumerNodeId: string;
  artifactContract: LegacyArtifactRequirementV2["artifactContract"];
  requiredFor: LegacyArtifactRequirementV2["requiredFor"];
  evidenceRefs: string[];
  rationale: string;
}): GraphAmendmentProposal {
  if (input.graph.nodes[input.producerNodeId] === undefined || input.graph.nodes[input.consumerNodeId] === undefined) throw new Error("Discovered artifact requirement references an unknown node.");
  if (input.evidenceRefs.length === 0) throw new Error("An amendment proposal requires evidence.");
  const identity = `${input.graph.graphId}:${input.graph.revision}:${input.producerNodeId}:${input.consumerNodeId}:${input.artifactContract.id}:${input.artifactContract.revision}:${input.requiredFor}`;
  const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  const requirement: LegacyArtifactRequirementV2 = {
    id: `artifact-requirement-${suffix}`,
    artifactContract: { ...input.artifactContract },
    producerNodeId: input.producerNodeId,
    consumerNodeId: input.consumerNodeId,
    requiredFor: input.requiredFor
  };
  return {
    proposalId: `amendment-${suffix}`,
    graphId: input.graph.graphId,
    sourceRevision: input.graph.revision,
    kind: "artifact_requirement",
    rationale: input.rationale,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
    operations: [{ type: "add_artifact_requirement", requirement }]
  };
}

export function applyApprovedGraphAmendment(
  graph: LegacyGraphRevisionV2,
  proposal: GraphAmendmentProposal,
  createdAt?: string
): LegacyGraphRevisionV2 {
  if (proposal.graphId !== graph.graphId || proposal.sourceRevision !== graph.revision) throw new Error(`Amendment ${proposal.proposalId} targets a stale graph revision.`);
  if (proposal.evidenceRefs.length === 0) throw new Error(`Amendment ${proposal.proposalId} has no evidence.`);
  return reviseLegacyGraphRevisionV2(graph, { expectedRevision: proposal.sourceRevision, operations: proposal.operations, ...(createdAt !== undefined ? { createdAt } : {}) });
}

export function computeAttemptFingerprintInvalidation(input: {
  attempts: Array<{ attemptId: string; nodeId: string; inputFingerprint: string }>;
  currentFingerprints: Record<string, string | undefined>;
}): { staleAttemptIds: string[]; staleNodeIds: string[]; freshAttemptIds: string[] } {
  const stale = input.attempts.filter((attempt) => input.currentFingerprints[attempt.nodeId] !== attempt.inputFingerprint);
  const fresh = input.attempts.filter((attempt) => input.currentFingerprints[attempt.nodeId] === attempt.inputFingerprint);
  return {
    staleAttemptIds: stale.map((attempt) => attempt.attemptId).sort(),
    staleNodeIds: [...new Set(stale.map((attempt) => attempt.nodeId))].sort(),
    freshAttemptIds: fresh.map((attempt) => attempt.attemptId).sort()
  };
}
