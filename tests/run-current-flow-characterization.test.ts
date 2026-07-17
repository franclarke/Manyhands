import { describe, expect, it } from "vitest";
import { artifactEvidenceIsReady, terminalDispositionForArtifact } from "@/lib/server/runs/final-artifact";
import { assertTransition } from "@/lib/server/runs/lifecycle";
import { RunRecordSchema, type RunRecord, type RunStatus } from "@/lib/server/runs/schema";

const TARGET_CONTEXT = {
  sourceRealPath: "C:/work/example-app",
  gitCommonDir: "C:/work/example-app/.git",
  sourceBranch: "main",
  sourceBaseCommit: "1111111111111111111111111111111111111111",
  fingerprint: "sha256:target-v1",
  capturedAt: "2026-07-17T00:00:00.000Z"
} as const;

const BASE_RUN = {
  runId: "run-current-flow",
  workspaceId: "workspace-current-flow",
  granularity: "balanced",
  model: "claude-sonnet-4.5",
  userPrompt: "Add appointment booking",
  title: "Appointment booking",
  version: 1,
  status: "created",
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
  targetContext: TARGET_CONTEXT
} as const;

describe("current run flow characterization", () => {
  it("persists the current create-to-delivery lifecycle without retargeting the run", () => {
    const stages: RunStatus[] = [
      "created",
      "generating",
      "needs_review",
      "approved",
      "running",
      "needs_delivery",
      "completed"
    ];

    const records = stages.map((status, index) => currentRecord(status, index));
    for (let index = 1; index < records.length; index += 1) {
      expect(() => assertTransition(records[index - 1]!.status, records[index]!.status)).not.toThrow();
    }
    expect(records.map((run) => run.targetContext)).toEqual(
      records.map(() => expect.objectContaining(TARGET_CONTEXT))
    );
    expect(records.at(2)?.planning).toBeDefined();
    expect(records.at(3)?.approvedPlanRevision).toBe(1);
    expect(records.at(4)?.execution).toBeDefined();
    expect(records.at(5)?.finalArtifactManifest).toBeDefined();
    expect(records.at(6)?.deliveryOutcome).toBe("delivered");
  });

  it("distinguishes an inspectable artifact from a delivered terminal result", () => {
    const pending = finalManifest("needs_delivery");
    const delivered = finalManifest("delivered");

    expect(artifactEvidenceIsReady(pending)).toBe(true);
    expect(terminalDispositionForArtifact({ manifest: pending, acceptedRisk: false })).toBe("needs_delivery");
    expect(terminalDispositionForArtifact({ manifest: delivered, acceptedRisk: false })).toBe("completed");
  });
});

function currentRecord(status: RunStatus, index: number): RunRecord {
  const planningReached = index >= 2;
  const approved = index >= 3;
  const executionReached = index >= 4;
  const artifactReached = index >= 5;
  const delivered = index >= 6;

  return RunRecordSchema.parse({
    ...BASE_RUN,
    status,
    version: index + 1,
    updatedAt: `2026-07-17T00:0${index}:00.000Z`,
    ...(planningReached
      ? { planning: { decomposition: { graph: { id: "graph-v1", rootId: "root" } } } }
      : {}),
    ...(approved ? { approvedAt: "2026-07-17T00:03:00.000Z", approvedPlanRevision: 1 } : {}),
    ...(executionReached ? { execution: { leafResults: [], integrationResults: [] } } : {}),
    ...(artifactReached
      ? {
          finalArtifactManifest: finalManifest(delivered ? "delivered" : "needs_delivery"),
          executionOutcome: "succeeded",
          artifactOutcome: "ready",
          deliveryOutcome: delivered ? "delivered" : "needs_delivery"
        }
      : {}),
    ...(delivered ? { completedAt: "2026-07-17T00:06:00.000Z" } : {})
  });
}

function finalManifest(deliveryDisposition: "needs_delivery" | "delivered") {
  return {
    version: 1 as const,
    manifestId: "11111111-1111-4111-8111-111111111111",
    runId: BASE_RUN.runId,
    sourceTargetFingerprint: TARGET_CONTEXT.fingerprint,
    sourceBranch: TARGET_CONTEXT.sourceBranch,
    sourceBaseSha: TARGET_CONTEXT.sourceBaseCommit,
    executionBaseSha: "2222222222222222222222222222222222222222",
    finalSha: "3333333333333333333333333333333333333333",
    finalRef: "refs/heads/manyhands/run-current-flow",
    addedFiles: ["src/appointments.ts"],
    modifiedFiles: [],
    deletedFiles: [],
    patch: "diff --git a/src/appointments.ts b/src/appointments.ts",
    validationCommands: [{ command: "pnpm", args: ["test"] }],
    validationResults: [{ passed: true, output: "passed", exitCode: 0 }],
    verificationDisposition: "verified" as const,
    omittedTasks: [],
    acceptedFailures: [],
    acceptedConflicts: [],
    repairEvidence: [],
    artifactDisposition: "ready" as const,
    deliveryDisposition,
    createdAt: "2026-07-17T00:05:00.000Z"
  };
}
