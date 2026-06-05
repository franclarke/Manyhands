import type { RunRecord } from "@/lib/server/runs/schema";

/**
 * Operational receipt for a run: a plain-language record of what was asked, what
 * was built, where it landed, and what passed/failed/repaired. Derived purely
 * from the persisted RunRecord so it can render in the UI and export to
 * JSON/Markdown without re-running anything.
 */
export interface RunReceipt {
  runId: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  finalApplicationStatus?: string;
  finalBranchName?: string;
  finalCommitSha?: string;
  baseCommit?: string;
  exportedPatchPath?: string;
  finalApplicationMessage?: string;
  filesChanged: string[];
  leaves: { total: number; succeeded: number; failed: number };
  integrations: { total: number; succeeded: number; repaired: number; failed: number };
  critics: { plan?: string; seam?: string };
  repositoryGrounding?: { fileCount: number; symbolCount: number };
}

const INTEGRATION_SUCCESS = new Set(["success", "executor_repair_success"]);

interface ExecutionShape {
  leafResults?: Array<{ taskId?: string; status?: string; changedFiles?: string[] }>;
  integrationResults?: Array<{ status?: string }>;
}

export function buildRunReceipt(run: RunRecord): RunReceipt {
  const execution = (run.execution ?? {}) as ExecutionShape;
  const leafResults = Array.isArray(execution.leafResults) ? execution.leafResults : [];
  const integrationResults = Array.isArray(execution.integrationResults) ? execution.integrationResults : [];

  const filesChanged = [
    ...new Set(leafResults.flatMap((leaf) => leaf.changedFiles ?? []))
  ].sort();

  const succeededLeaves = leafResults.filter((leaf) => leaf.status === "success").length;
  const succeededIntegrations = integrationResults.filter((entry) => INTEGRATION_SUCCESS.has(entry.status ?? "")).length;
  const repairedIntegrations = integrationResults.filter((entry) => entry.status === "executor_repair_success").length;

  const receipt: RunReceipt = {
    runId: run.runId,
    title: run.title,
    prompt: run.userPrompt,
    status: run.status,
    createdAt: run.createdAt,
    filesChanged,
    leaves: {
      total: leafResults.length,
      succeeded: succeededLeaves,
      failed: leafResults.length - succeededLeaves
    },
    integrations: {
      total: integrationResults.length,
      succeeded: succeededIntegrations,
      repaired: repairedIntegrations,
      failed: integrationResults.length - succeededIntegrations
    },
    critics: {
      ...(run.planningCritic !== undefined ? { plan: run.planningCritic.status } : {}),
      ...(run.seamCritic !== undefined ? { seam: run.seamCritic.status } : {})
    }
  };

  if (run.completedAt !== undefined) receipt.completedAt = run.completedAt;
  if (run.finalApplicationStatus !== undefined) receipt.finalApplicationStatus = run.finalApplicationStatus;
  if (run.finalBranchName !== undefined) receipt.finalBranchName = run.finalBranchName;
  if (run.finalCommitSha !== undefined) receipt.finalCommitSha = run.finalCommitSha;
  if (run.baseCommit !== undefined) receipt.baseCommit = run.baseCommit;
  if (run.exportedPatchPath !== undefined) receipt.exportedPatchPath = run.exportedPatchPath;
  if (run.finalApplicationMessage !== undefined) receipt.finalApplicationMessage = run.finalApplicationMessage;
  if (run.repositoryGrounding !== undefined) {
    receipt.repositoryGrounding = {
      fileCount: run.repositoryGrounding.fileCount,
      symbolCount: run.repositoryGrounding.symbolCount
    };
  }

  return receipt;
}

export function renderRunReceiptMarkdown(receipt: RunReceipt): string {
  const lines: string[] = [
    `# ManyHands run — ${receipt.title}`,
    "",
    `- **Run**: \`${receipt.runId}\``,
    `- **Status**: ${receipt.status}`,
    `- **Requested**: ${receipt.prompt}`,
    `- **Created**: ${receipt.createdAt}`
  ];
  if (receipt.completedAt !== undefined) lines.push(`- **Completed**: ${receipt.completedAt}`);

  lines.push("", "## Final application");
  if (receipt.finalApplicationStatus === "applied") {
    lines.push(
      `- Applied to branch \`${receipt.finalBranchName ?? "?"}\` (commit \`${shortSha(receipt.finalCommitSha)}\`).`,
      `- Base commit: \`${shortSha(receipt.baseCommit)}\`.`
    );
  } else if (receipt.finalApplicationStatus === "exported_patch") {
    lines.push(`- Patch exported to \`${receipt.exportedPatchPath ?? "?"}\` (not applied to a branch).`);
  } else if (receipt.finalApplicationStatus === "failed") {
    lines.push(`- Application failed: ${receipt.finalApplicationMessage ?? "unknown reason"}.`);
  } else {
    lines.push("- No final application recorded yet.");
  }

  lines.push(
    "",
    "## Execution",
    `- Leaves: ${receipt.leaves.succeeded}/${receipt.leaves.total} succeeded${receipt.leaves.failed > 0 ? `, ${receipt.leaves.failed} failed` : ""}.`,
    `- Integrations: ${receipt.integrations.succeeded}/${receipt.integrations.total} succeeded` +
      `${receipt.integrations.repaired > 0 ? `, ${receipt.integrations.repaired} repaired` : ""}` +
      `${receipt.integrations.failed > 0 ? `, ${receipt.integrations.failed} failed` : ""}.`
  );
  if (receipt.critics.plan !== undefined || receipt.critics.seam !== undefined) {
    lines.push(`- Critics: plan=${receipt.critics.plan ?? "n/a"}, seam=${receipt.critics.seam ?? "n/a"}.`);
  }

  lines.push("", `## Files changed (${receipt.filesChanged.length})`);
  if (receipt.filesChanged.length === 0) {
    lines.push("- (none)");
  } else {
    for (const file of receipt.filesChanged) lines.push(`- \`${file}\``);
  }

  return `${lines.join("\n")}\n`;
}

function shortSha(sha: string | undefined): string {
  return sha === undefined ? "?" : sha.slice(0, 10);
}
