import type { ConflictConstraintEvidence } from "@manyhands/conflict-risk";
import { explainReadiness } from "./readiness-v2.js";
import type { ReadinessExplanationV2, ReadinessStateV2 } from "./types-v2.js";
import type { LegacyGraphRevisionV2 } from "@manyhands/task-graph";

export interface ReadyWaveSelectionInput {
  graph: LegacyGraphRevisionV2;
  nodeIds: string[];
  state: ReadinessStateV2;
  effectiveConfig: { maxParallel: number };
  conflictConstraints: ConflictConstraintEvidence[];
  now?: string;
}

export interface ReadyWaveSelection {
  nodeIds: string[];
  explanations: ReadinessExplanationV2[];
  effectiveConflictConstraints: Array<ConflictConstraintEvidence | {
    id: string;
    leftNodeId: string;
    rightNodeId: string;
    reason: string;
    risk: "low" | "medium" | "high";
  }>;
}

export function selectReadyWaveV2(input: ReadyWaveSelectionInput): ReadyWaveSelection {
  if (!Number.isInteger(input.effectiveConfig.maxParallel) || input.effectiveConfig.maxParallel <= 0) throw new Error("Persisted effectiveConfig.maxParallel must be a positive integer.");
  const sortedNodeIds = [...input.nodeIds].sort((a, b) => a.localeCompare(b));
  const explanations = sortedNodeIds.map((nodeId) => explainReadiness({ graph: input.graph, nodeId, ...input.state }));
  const selected: string[] = [];
  const allConstraints = [...(input.graph.conflictConstraints ?? []), ...input.conflictConstraints].filter((constraint) =>
    isCurrentConstraint(constraint, input.now)
  );
  for (const exp of explanations) {
    if (!exp.ready) continue;
    const candidate = exp.nodeId;
    const blockedByActive = input.state.activeResourceNodeIds.some((active) => blocksPair(allConstraints, candidate, active));
    const blockedBySelected = selected.some((other) => blocksPair(allConstraints, candidate, other));
    if (blockedByActive || blockedBySelected) {
      exp.deferred = true;
      exp.reasons.push({ code: "active_resource_constraint" });
      continue;
    }
    if (selected.length < input.effectiveConfig.maxParallel) {
      selected.push(candidate);
    }
  }
  return { nodeIds: selected, explanations, effectiveConflictConstraints: allConstraints };
}

function blocksPair(constraints: Array<{ leftNodeId: string; rightNodeId: string; risk: string; mode?: string | undefined; resourceId?: string | undefined }>, left: string, right: string): boolean {
  const resourceIdsFor = (nodeId: string): Set<string> => new Set(
    constraints
      .filter((constraint) => constraint.mode === "resource_lock" && constraint.resourceId !== undefined && (constraint.leftNodeId === nodeId || constraint.rightNodeId === nodeId))
      .map((constraint) => constraint.resourceId!)
  );
  const leftResources = resourceIdsFor(left);
  const rightResources = resourceIdsFor(right);
  if ([...leftResources].some((resourceId) => rightResources.has(resourceId))) return true;
  return constraints.some((constraint) =>
    ((constraint.leftNodeId === left && constraint.rightNodeId === right) ||
     (constraint.leftNodeId === right && constraint.rightNodeId === left)) &&
    constraint.mode !== "advisory" &&
    (constraint.mode === "resource_lock" || ["unknown", "high", "blocking"].includes(constraint.risk))
  );
}

function isCurrentConstraint(constraint: unknown, now: string | undefined): boolean {
  if (typeof constraint !== "object" || constraint === null || !("expiresAt" in constraint)) return true;
  const expiresAtValue = (constraint as { expiresAt?: unknown }).expiresAt;
  if (typeof expiresAtValue !== "string" || now === undefined) return true;
  const expiresAt = Date.parse(expiresAtValue);
  const evaluatedAt = Date.parse(now);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(evaluatedAt)) return true;
  return expiresAt > evaluatedAt;
}
