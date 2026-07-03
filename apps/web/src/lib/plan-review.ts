import type { RunSnapshot } from "@manyhands/core";
import type { AgentTaskContract } from "@manyhands/contracts";
import { validateExecutableTaskGraph, type TaskGraph } from "@manyhands/task-graph";
import { runSeamCritic } from "@/lib/plan-critic";

export type PlanReviewStatus = "clean" | "warnings" | "errors";

export interface PlanReviewIssue {
  severity: "warning" | "error";
  kind: "graph" | "contract" | "risk" | "seam";
  taskId?: string;
  title: string;
  detail: string;
}

export interface PlanReviewPatchCounts {
  humanEdits: number;
  subtreeRegenerations: number;
  dependenciesAdded: number;
  dependenciesRemoved: number;
  integratorsAdded: number;
  riskAcknowledgements: number;
}

export interface PlanReviewSummary {
  status: PlanReviewStatus;
  issueCounts: {
    errors: number;
    warnings: number;
  };
  readiness: {
    totalLeaves: number;
    contractReadyLeaves: number;
    scopeReadyLeaves: number;
    acceptanceReadyLeaves: number;
    expectedOutputReadyLeaves: number;
  };
  issues: PlanReviewIssue[];
  highRiskCount: number;
  unacknowledgedHighRiskCount: number;
  patchCounts: PlanReviewPatchCounts;
}

const NODE_EDIT_PATCH_TYPES = new Set([
  "NODE_RENAMED",
  "NODE_OBJECTIVE_EDITED",
  "NODE_PATHS_EDITED",
  "NODE_ACCEPTANCE_EDITED",
  "NODE_MARKED_MANUAL"
]);

export function buildPlanReviewSummary(
  snapshot: RunSnapshot | null,
  patches: readonly unknown[] = []
): PlanReviewSummary | null {
  if (snapshot === null) {
    return null;
  }

  const issues: PlanReviewIssue[] = [];
  for (const issue of validateExecutableTaskGraph(snapshot.graphSnapshot as unknown as TaskGraph)) {
    issues.push({
      severity: issue.severity,
      kind: "graph",
      ...(issue.taskId !== undefined ? { taskId: issue.taskId } : {}),
      title: issue.code.replace(/_/g, " "),
      detail: issue.message
    });
  }

  const leaves = Object.values(snapshot.graphSnapshot.nodes).filter((node) => node.kind === "leaf");
  let contractReadyLeaves = 0;
  let scopeReadyLeaves = 0;
  let acceptanceReadyLeaves = 0;
  let expectedOutputReadyLeaves = 0;

  for (const leaf of leaves) {
    const contract = snapshot.contracts.find((entry) => entry.taskId === leaf.id) ?? leaf.contract;
    if (contract === undefined) {
      issues.push({
        severity: "warning",
        kind: "contract",
        taskId: leaf.id,
        title: "Missing contract",
        detail: `${leaf.title} has no executable agent contract.`
      });
      continue;
    }

    contractReadyLeaves += 1;

    if (contract.allowed.paths.length > 0) {
      scopeReadyLeaves += 1;
    } else {
      issues.push({
        severity: "warning",
        kind: "contract",
        taskId: leaf.id,
        title: "Missing scope",
        detail: `${leaf.title} has no allowed paths.`
      });
    }

    if (contract.acceptance.length > 0 || (leaf.acceptanceCriteria?.length ?? 0) > 0) {
      acceptanceReadyLeaves += 1;
    } else {
      issues.push({
        severity: "warning",
        kind: "contract",
        taskId: leaf.id,
        title: "Missing acceptance",
        detail: `${leaf.title} has no acceptance criteria.`
      });
    }

    if (contract.expectedOutput.changedFiles.length > 0) {
      expectedOutputReadyLeaves += 1;
    } else {
      issues.push({
        severity: "warning",
        kind: "contract",
        taskId: leaf.id,
        title: "Missing expected output",
        detail: `${leaf.title} does not declare expected changed files.`
      });
    }
  }

  // Seam consistency (Fase 2.3): every consumed seam needs a producer with a
  // matching, concrete signature. Reuses the deterministic SeamCritic.
  const seamResult = runSeamCritic({
    graph: snapshot.graphSnapshot as unknown as TaskGraph,
    contracts: snapshot.contracts as unknown as AgentTaskContract[]
  });
  for (const finding of seamResult.findings) {
    if (finding.severity === "info") {
      continue;
    }
    issues.push({
      severity: finding.severity,
      kind: "seam",
      ...(finding.taskId !== undefined ? { taskId: finding.taskId } : {}),
      title: finding.code.replace(/_/g, " "),
      detail: finding.suggestion !== undefined ? `${finding.message} ${finding.suggestion}` : finding.message
    });
  }

  const highRiskPredictions = snapshot.riskPredictions.filter(
    (risk) => risk.level === "high" || risk.level === "blocking"
  );
  const unacknowledgedHighRisks = highRiskPredictions.filter(
    (risk) => (risk as { acknowledged?: unknown }).acknowledged !== true
  );
  for (const risk of unacknowledgedHighRisks) {
    issues.push({
      severity: "warning",
      kind: "risk",
      title: `Unacknowledged ${risk.level} risk`,
      detail: `${risk.taskAId} <-> ${risk.taskBId}: ${risk.recommendation}`
    });
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;

  return {
    status: errors > 0 ? "errors" : warnings > 0 ? "warnings" : "clean",
    issueCounts: { errors, warnings },
    readiness: {
      totalLeaves: leaves.length,
      contractReadyLeaves,
      scopeReadyLeaves,
      acceptanceReadyLeaves,
      expectedOutputReadyLeaves
    },
    issues,
    highRiskCount: highRiskPredictions.length,
    unacknowledgedHighRiskCount: unacknowledgedHighRisks.length,
    patchCounts: countPatches(patches)
  };
}

function countPatches(patches: readonly unknown[]): PlanReviewPatchCounts {
  const counts: PlanReviewPatchCounts = {
    humanEdits: 0,
    subtreeRegenerations: 0,
    dependenciesAdded: 0,
    dependenciesRemoved: 0,
    integratorsAdded: 0,
    riskAcknowledgements: 0
  };

  for (const patch of patches) {
    const type = patchType(patch);
    if (type === undefined) {
      continue;
    }
    if (NODE_EDIT_PATCH_TYPES.has(type)) counts.humanEdits += 1;
    if (type === "SUBTREE_REGENERATED") counts.subtreeRegenerations += 1;
    if (type === "TASKS_SERIALIZED") counts.dependenciesAdded += 1;
    if (type === "DEPENDENCY_REMOVED") counts.dependenciesRemoved += 1;
    if (type === "INTEGRATOR_NODE_CREATED") counts.integratorsAdded += 1;
    if (type === "RISK_ACKNOWLEDGED") counts.riskAcknowledgements += 1;
  }

  return counts;
}

function patchType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}
