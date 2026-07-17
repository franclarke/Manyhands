import type { ReadinessExplanationV2, ReadinessInputV2, ReadinessReason } from "./types-v2.js";

export function explainReadiness(input: ReadinessInputV2): ReadinessExplanationV2 {
  const node = input.graph.nodes[input.nodeId];
  if (node === undefined) throw new Error(`Unknown graph node ${input.nodeId}.`);
  const reasons: ReadinessReason[] = [];
  const requiredPhases = node.kind === "root" || node.kind === "composite"
    ? new Set(["execution", "integration"])
    : new Set(["execution"]);
  for (const requirement of input.graph.artifactRequirements.filter((item) => item.consumerNodeId === input.nodeId && requiredPhases.has(item.requiredFor))) {
    const adopted = input.adoptedArtifacts.some((artifact) => artifact.artifactId === requirement.artifactContract.id && artifact.revision === requirement.artifactContract.revision);
    if (!adopted) reasons.push({ code: "missing_artifact", artifactId: requirement.artifactContract.id, requiredRevision: requirement.artifactContract.revision });
  }
  for (const contract of input.requiredContractRevisions?.[input.nodeId] ?? []) {
    const current = input.currentContractRevisions[contract.id];
    if (current !== contract.revision) reasons.push({ code: "stale_contract", contractId: contract.id, requiredRevision: contract.revision, ...(current !== undefined ? { currentRevision: current } : {}) });
  }
  for (const decision of input.pendingDecisions) if (decision.affectedNodeIds.includes(input.nodeId)) reasons.push({ code: "unresolved_decision", decisionId: decision.decisionId });
  if (!input.materializableNodeIds.includes(input.nodeId)) reasons.push({ code: "unmaterializable_base" });
  if (input.activeResourceNodeIds.includes(input.nodeId)) reasons.push({ code: "active_resource_constraint" });
  if (!input.budgetAvailable) reasons.push({ code: "budget_exhausted" });
  if (!input.availableExecutorNodeIds.includes(input.nodeId)) reasons.push({ code: "executor_unavailable" });
  if (input.adoptedNodeIds.includes(input.nodeId)) reasons.push({ code: "already_adopted" });
  return { nodeId: input.nodeId, ready: reasons.length === 0, reasons };
}
