import { ExecutionConfigSchema } from "@manyhands/execution-core";

import type { RunRecord, RunStatus } from "@/lib/server/runs/schema";

const AT = "2026-07-17T12:00:00.000Z";

export function makeRunRecordV2(
  overrides: Partial<RunRecord> & { runId?: string; lifecycle?: RunStatus } = {}
): RunRecord {
  const lifecycle = overrides.lifecycle ?? overrides.projection?.lifecycle ?? "planning";
  const base: RunRecord = {
    runId: overrides.runId ?? "run-v2",
    workspaceId: "workspace-v2",
    userPrompt: "Implement the requested feature",
    title: "Implement feature",
    planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
    repairSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionConfig: ExecutionConfigSchema.parse({}),
    targetContext: {
      sourceRealPath: "C:/repo/example",
      gitCommonDir: "C:/repo/example/.git",
      physicalIdentity: { version: 1, device: "1", file: "2" },
      sourceBranch: "main",
      sourceBaseCommit: "1".repeat(40),
      fingerprint: "target-fingerprint-v2",
      capturedAt: AT
    },
    projection: {
      eventSequence: 0,
      lifecycle,
      updatedAt: AT
    },
    version: 0,
    createdAt: AT,
    updatedAt: AT
  };
  const { lifecycle: _lifecycle, ...recordOverrides } = overrides;
  return {
    ...base,
    ...recordOverrides,
    projection: overrides.projection ?? base.projection
  };
}
