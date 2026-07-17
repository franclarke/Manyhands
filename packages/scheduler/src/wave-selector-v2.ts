import type { ConflictConstraintEvidence } from "@manyhands/conflict-risk";
import { explainReadiness } from "./readiness-v2.js";
import type { ReadinessStateV2 } from "./types-v2.js";
import type { GraphRevision } from "@manyhands/task-graph";

export function selectReadyWaveV2(input: { graph: GraphRevision; nodeIds: string[]; state: ReadinessStateV2; effectiveConfig: { maxParallel: number }; conflictConstraints: ConflictConstraintEvidence[] }): { nodeIds: string[]; explanations: ReturnType<typeof explainReadiness>[] } {
  if (!Number.isInteger(input.effectiveConfig.maxParallel) || input.effectiveConfig.maxParallel <= 0) throw new Error("Persisted effectiveConfig.maxParallel must be a positive integer.");
  const explanations = input.nodeIds.map((nodeId) => explainReadiness({ graph: input.graph, nodeId, ...input.state }));
  const selected: string[] = [];
  for (const candidate of explanations.filter((item) => item.ready).map((item) => item.nodeId)) {
    if (selected.length >= input.effectiveConfig.maxParallel) break;
    if (selected.every((other) => !blocksPair(input.conflictConstraints, candidate, other))) selected.push(candidate);
  }
  return { nodeIds: selected, explanations };
}

function blocksPair(constraints: ConflictConstraintEvidence[], left: string, right: string): boolean {
  return constraints.some((constraint) => new Set([constraint.leftNodeId, constraint.rightNodeId]).has(left) && new Set([constraint.leftNodeId, constraint.rightNodeId]).has(right) && ["unknown", "high", "blocking"].includes(constraint.risk));
}
