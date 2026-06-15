import { buildTaskPairRiskMatrix, type ConflictPrediction } from "@manyhands/conflict-risk";
import type { RunSnapshot } from "@manyhands/core";
import type { RunPatch } from "@/lib/server/runs/patches";

export type ConflictViewRiskLevel = ConflictPrediction["level"];

export interface ConflictListItem {
  pairKey: string;
  taskAId: string;
  taskBId: string;
  taskATitle: string;
  taskBTitle: string;
  level: ConflictViewRiskLevel;
  score: number;
  reason: string;
  recommendation: ConflictPrediction["recommendation"];
  sharedFiles: string[];
  sharedPaths: string[];
  sharedSymbols: string[];
  evidence: ConflictPrediction["evidence"];
  suggestedDependency?: ConflictPrediction["suggestedDependency"];
  acknowledged: boolean;
  acknowledgedReason?: string;
  acknowledgedAt?: string;
}

const actionableLevels = new Set<ConflictViewRiskLevel>(["medium", "high", "blocking"]);

export function deriveConflictList(snapshot: RunSnapshot, patches: readonly unknown[]): ConflictListItem[] {
  const leafTaskIds = new Set(
    Object.values(snapshot.graphSnapshot.nodes)
      .filter((node) => node.kind === "leaf")
      .map((node) => node.id)
  );
  const contracts = Object.fromEntries(
    snapshot.contracts
      .filter((contract) => leafTaskIds.has(contract.taskId))
      .map((contract) => [contract.taskId, contract])
  );
  const matrix = buildTaskPairRiskMatrix({
    contracts,
    staticSignals: snapshot.staticConflictSignals
  });
  const acknowledgements = acknowledgedRiskPairs(patches);
  const seen = new Set<string>();
  const conflicts: ConflictListItem[] = [];

  for (const prediction of matrix) {
    if (prediction.evidence.length === 0 && !actionableLevels.has(prediction.level)) {
      continue;
    }

    const pairKey = canonicalPairKey(prediction.taskAId, prediction.taskBId);
    if (seen.has(pairKey)) {
      continue;
    }
    seen.add(pairKey);

    const acknowledgement = acknowledgements.get(pairKey);
    const item: ConflictListItem = {
      pairKey,
      taskAId: prediction.taskAId,
      taskBId: prediction.taskBId,
      taskATitle: snapshot.graphSnapshot.nodes[prediction.taskAId]?.title ?? prediction.taskAId,
      taskBTitle: snapshot.graphSnapshot.nodes[prediction.taskBId]?.title ?? prediction.taskBId,
      level: prediction.level,
      score: prediction.score,
      reason: prediction.explanation,
      recommendation: prediction.recommendation,
      sharedFiles: [...prediction.sharedFiles],
      sharedPaths: sharedPathsFromPrediction(prediction),
      sharedSymbols: [...prediction.sharedSymbols],
      evidence: prediction.evidence.map((entry) => ({ ...entry })),
      acknowledged: acknowledgement !== undefined
    };

    if (prediction.suggestedDependency !== undefined) {
      item.suggestedDependency = { ...prediction.suggestedDependency };
    }
    if (acknowledgement !== undefined) {
      item.acknowledgedReason = acknowledgement.reason;
      item.acknowledgedAt = acknowledgement.createdAt;
    }
    conflicts.push(item);
  }

  return conflicts.sort((left, right) => {
    const acknowledged = Number(left.acknowledged) - Number(right.acknowledged);
    if (acknowledged !== 0) return acknowledged;
    const risk = riskRank[right.level] - riskRank[left.level];
    if (risk !== 0) return risk;
    return left.pairKey.localeCompare(right.pairKey);
  });
}

export function canonicalPairKey(taskAId: string, taskBId: string): string {
  return [taskAId, taskBId].sort((left, right) => left.localeCompare(right)).join("::");
}

function acknowledgedRiskPairs(patches: readonly unknown[]): Map<string, { reason: string; createdAt: string }> {
  const result = new Map<string, { reason: string; createdAt: string }>();
  for (const patch of patches) {
    const parsed = riskAcknowledgementFromUnknown(patch);
    if (parsed === null) {
      continue;
    }
    const key = canonicalPairKey(parsed.taskIds[0], parsed.taskIds[1]);
    result.set(key, {
      reason: parsed.reason,
      createdAt: parsed.createdAt
    });
  }
  return result;
}

function riskAcknowledgementFromUnknown(value: unknown): RiskAcknowledgementPatch | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.type !== "RISK_ACKNOWLEDGED") {
    return null;
  }
  const taskIds = record.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length !== 2) {
    return null;
  }
  const left = taskIds[0];
  const right = taskIds[1];
  if (typeof left !== "string" || typeof right !== "string") {
    return null;
  }
  return {
    id: typeof record.id === "string" ? record.id : "unknown-risk-patch",
    type: "RISK_ACKNOWLEDGED",
    actor: record.actor === "system" ? "system" : "human",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    taskIds: [left, right],
    reason: typeof record.reason === "string" ? record.reason : "Acknowledged"
  };
}

function sharedPathsFromPrediction(prediction: ConflictPrediction): string[] {
  const paths = new Set<string>();
  for (const evidence of prediction.evidence) {
    if (evidence.signal !== "path_overlap" && evidence.signal !== "critical_path" && evidence.signal !== "shared_test_fixture") {
      continue;
    }
    const marker = evidence.detail.includes(":") ? evidence.detail.split(":").slice(1).join(":") : evidence.detail;
    for (const part of marker.split(",")) {
      const value = part.trim();
      if (value.length > 0) {
        paths.add(value);
      }
    }
  }
  return [...paths].sort();
}

const riskRank: Record<ConflictViewRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  blocking: 3
};

export type RiskAcknowledgementPatch = Extract<RunPatch, { type: "RISK_ACKNOWLEDGED" }>;
