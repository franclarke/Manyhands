import { describe, expect, it } from "vitest";
import { IntegrationManifestExecutor, createIntegrationRequestManifest } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

describe("integration contract validation", () => {
  it("does not call a clean cherry-pick successful when parent evidence fails", async () => {
    const git = new FakeGitRunner({ heads: { "/wt": "BASE" }, cherryPickResultShas: ["PICK"] });
    const request = createIntegrationRequestManifest({
      runId: "run-1", integrationAttemptId: "attempt-parent", compositeNode: { id: "parent", graphRevision: 1 },
      base: { manifestId: "base", resultingCommit: "BASE", inputFingerprint: `sha256:${"a".repeat(64)}` },
      availableArtifacts: [{ schemaVersion: 1, artifactId: "child", runId: "run-1", nodeId: "child", digest: "digest", producerAttemptId: "attempt", contract: { id: "contract", revision: "rev-1" }, kind: "commit", location: "SHA", adoptedAt: "2026-07-17T12:00:00.000Z" }],
      requiredArtifactIds: ["child"], seamRevisions: [], parentGoal: "Compose",
      validationContract: { id: "validation", revision: "rev-1" },
      outputArtifactContract: { id: "artifact-parent", revision: "rev-1" },
      createdAt: "2026-07-17T12:00:00.000Z"
    });
    const result = await new IntegrationManifestExecutor({
      allowCommitTransport: true, // legacy commit-replay characterization; retired from the productive route in Stage 9
      git,
      validate: async () => ({ matrixId: "matrix-failed", outcome: "failed" }),
      digestCandidate: async () => "must-not-be-used"
    }).integrate({ request, worktreePath: "/wt" });
    expect(result.disposition).toBe("failed");
    expect(result.parentEvidence).toEqual({ matrixId: "matrix-failed", outcome: "failed" });
    expect(result).not.toHaveProperty("outputArtifacts");
  });
});
