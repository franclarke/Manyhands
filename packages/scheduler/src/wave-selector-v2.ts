import type { ConflictConstraintEvidence } from "@manyhands/conflict-risk";
import { explainReadiness } from "./readiness-v2.js";
import type { ReadinessStateV2 } from "./types-v2.js";
import type { GraphRevision } from "@manyhands/task-graph";

export function selectReadyWaveV2(input: { graph: GraphRevision; nodeIds: string[]; state: ReadinessStateV2; effectiveConfig: { maxParallel: number }; conflictConstraints: ConflictConstraintEvidence[] }): { nodeIds: string[]; explanations: ReturnType<typeof explainReadiness>[] } {
  if (!Number.isInteger(input.effectiveConfig.maxParallel) || input.effectiveConfig.maxParallel <= 0) throw new Error("Persisted effectiveConfig.maxParallel must be a positive integer.");
  const sortedNodeIds = [...input.nodeIds].sort((a, b) => a.localeCompare(b));
  const explanations = sortedNodeIds.map((nodeId) => explainReadiness({ graph: input.graph, nodeId, ...input.state }));
  const selected: string[] = [];
  const allConstraints = [...(input.graph.conflictConstraints ?? []), ...input.conflictConstraints];
  for (const exp of explanations) {
    if (!exp.ready) continue;
    const candidate = exp.nodeId;
    const blockedByActive = input.state.activeResourceNodeIds.some((active) => blocksPair(allConstraints, candidate, active));
    const blockedBySelected = selected.some((other) => blocksPair(allConstraints, candidate, other));
    if (blockedByActive || blockedBySelected) {
      exp.deferred = true;
      continue;
    }
    if (selected.length < input.effectiveConfig.maxParallel) {
      selected.push(candidate);
    }
  }
  return { nodeIds: selected, explanations };
}

function blocksPair(constraints: Array<{ leftNodeId: string; rightNodeId: string; risk: string }>, left: string, right: string): boolean {
  return constraints.some((constraint) =>
    ((constraint.leftNodeId === left && constraint.rightNodeId === right) ||
     (constraint.leftNodeId === right && constraint.rightNodeId === left)) &&
    ["unknown", "high", "blocking"].includes(constraint.risk)
  );
}
